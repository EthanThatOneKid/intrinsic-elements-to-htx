import { MuxAsyncIterator } from "@std/async/mux-async-iterator";
import type { WalkEntry } from "@std/fs/walk";
import { expandGlob } from "@std/fs/expand-glob";
import type { SourceFile } from "ts-morph";
import { Project, ts } from "ts-morph";
import { getDescriptors } from "@fartlabs/ht/cli/codegen";

export const htxSpecifier = "@fartlabs/htx";
export const htxDescriptors = getDescriptors();
export const commonIntrinsicElements = new Set(
  htxDescriptors.map((descriptor) => descriptor.tag),
);

if (import.meta.main) {
  const project = new Project();
  for (const entry of await expandTsxFiles(Deno.args)) {
    const sourceFile = project.addSourceFileAtPath(entry.path);
    processTsxSourceFile(sourceFile);
  }

  await project.save();
}

/**
 * processTsxSourceFile modifies a TSX source file to use htx instead of common
 * intrinsic elements.
 */
export function processTsxSourceFile(sourceFile: SourceFile) {
  // Find all JSX elements in the source file.
  const tagNames = new Set<string>();

  // Find all the JSX elements with closing tags in the source file and modify them.
  sourceFile
    .getDescendantsOfKind(ts.SyntaxKind.JsxElement)
    .forEach((jsxElement) => {
      // Modify common intrinsic elements to use htx.
      const openingElementNode = jsxElement
        .getFirstChildByKind(ts.SyntaxKind.JsxOpeningElement);
      if (openingElementNode === undefined) {
        return;
      }

      const openingIdentifierNode = openingElementNode
        .getFirstChildByKind(ts.SyntaxKind.Identifier);
      const tagName = openingIdentifierNode?.getText();
      if (!tagName) {
        throw new Error("Expected tag name");
      }

      if (!commonIntrinsicElements.has(tagName)) {
        return;
      }
      openingIdentifierNode?.replaceWithText(tagName.toUpperCase());
      tagNames.add(tagName);

      // Modify closing element if it exists.
      const closingElementNode = jsxElement
        .getFirstChildByKind(ts.SyntaxKind.JsxClosingElement);
      if (closingElementNode !== undefined) {
        const closingIdentifierNode = closingElementNode
          .getFirstChildByKind(ts.SyntaxKind.Identifier);
        closingIdentifierNode?.replaceWithText(tagName.toUpperCase());
      }
    });

  sourceFile
    .getDescendantsOfKind(ts.SyntaxKind.JsxSelfClosingElement)
    .forEach((jsxElement) => {
      // Modify common intrinsic elements to use htx.
      const openingElementNode = jsxElement
        .getFirstChildByKind(ts.SyntaxKind.Identifier);
      if (openingElementNode === undefined) {
        return;
      }

      const tagName = openingElementNode.getText();
      if (tagName === undefined) {
        throw new Error("Expected tag name");
      }

      if (!commonIntrinsicElements.has(tagName)) {
        return;
      }

      openingElementNode.replaceWithText(tagName.toUpperCase());
      tagNames.add(tagName);
    });

  // Update the htx import or prepend it if it doesn't exist.
  const htxImport = sourceFile.getImportDeclaration(htxSpecifier) ??
    sourceFile.addImportDeclaration({ moduleSpecifier: htxSpecifier });
  Array.from(tagNames)
    .toSorted()
    .forEach((tagName) => {
      htxImport.addNamedImport({ name: tagName.toUpperCase() });
    });
}

async function expandTsxFiles(globs: string[]): Promise<WalkEntry[]> {
  const entries = await Array.fromAsync(expandGlobs(globs));
  for (const entry of entries) {
    if (!entry.isFile) {
      throw new Error(`Expected file, got ${entry.path}`);
    }

    const isTsx = /\.[jt]sx$/.test(entry.path);
    if (!isTsx) {
      throw new Error(`Expected .jsx or .tsx file, got ${entry.path}`);
    }
  }

  return entries;
}

function expandGlobs(globs: string[]): AsyncIterableIterator<WalkEntry> {
  const mux = new MuxAsyncIterator<WalkEntry>();
  for (const glob of globs) {
    mux.add(expandGlob(glob));
  }

  return mux.iterate();
}
