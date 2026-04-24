import { OlogStore } from '../../db.js';
import type { OlogElem } from '../../ontology.js';
import type { SourceEdit } from '../edit.js';
import { parseSpan } from './rename.js';
import { findEnclosingDeclaration, findImportStatement } from '../declaration.js';
import { parseImports, findImportInsertionPoint, formatNamedImport } from '../imports.js';
import { computeRelativeImportPath, filePathToModule } from '../paths.js';

export interface MoveEdits {
  edits: SourceEdit[];
  warnings: string[];
}

export function computeMoveEdits(
  store: OlogStore,
  elementId: string,
  newModule: string,
  readFile: (path: string) => string | null,
): MoveEdits {
  const edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const elem = store.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }

  if (!elem.span || !elem.module) {
    warnings.push(`Element ${elementId} has no span or module`);
    return { edits, warnings };
  }

  const sourceModule = elem.module;

  // 1. Extract the full declaration text from the source module
  const sourceContent = readFile(sourceModule);
  if (!sourceContent) {
    warnings.push(`Cannot read source file: ${sourceModule}`);
    return { edits, warnings };
  }

  const parsedSpan = parseSpan(elem.span);
  if (!parsedSpan) {
    warnings.push(`Cannot parse span: ${elem.span}`);
    return { edits, warnings };
  }

  const declarationRange = findEnclosingDeclaration(
    sourceContent, sourceModule,
    parsedSpan.startLine, parsedSpan.startCol,
    elem.kind,
  );

  if (!declarationRange) {
    warnings.push(`Cannot find enclosing declaration for ${elem.name} in ${sourceModule}`);
    return { edits, warnings };
  }

  let declarationText = declarationRange.text;

  // 2. Adjust relative imports within the moved declaration
  // (If the declaration imports from relative paths, they need updating)
  const oldModulePath = filePathToModule(sourceModule);
  const newModulePath = filePathToModule(newModule);
  const declImports = parseImports(declarationText);
  for (const imp of declImports) {
    if (imp.sourcePath.startsWith('.')) {
      const oldPath = imp.sourcePath;
      // Compute new relative path from newModule to the same target
      const targetModule = filePathToModule(imp.sourcePath.replace(/^\.\//, ''));
      // This is approximate — relative path computation needs the actual resolved path
      const newPath = computeRelativeImportPath(newModule, imp.sourcePath);
      // We'll handle this in a more sophisticated version
      // For now, just note it
      warnings.push(`Move may require updating import path: "${oldPath}" in moved declaration`);
    }
  }

  // 3. Delete the declaration from the source module
  edits.push({
    filePath: sourceModule,
    label: `remove declaration: ${elem.name} from ${sourceModule}`,
    oldText: declarationText,
    newText: '',
    startLine: declarationRange.startLine,
    startCol: declarationRange.startCol,
    endLine: declarationRange.endLine,
    endCol: declarationRange.endCol,
  });

  // 4. Insert the declaration into the target module
  const targetContent = readFile(newModule);
  if (targetContent) {
    const insertLine = findImportInsertionPoint(targetContent);
    edits.push({
      filePath: newModule,
      label: `add declaration: ${elem.name} to ${newModule}`,
      oldText: null,
      newText: '\n' + declarationText + '\n',
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1,
    });

    // 5. Add import in the target module if needed
    const targetImports = parseImports(targetContent);
    const importPath = computeRelativeImportPath(newModule, oldModulePath);
    const alreadyImports = targetImports.some(imp => imp.sourcePath === importPath);

    if (!alreadyImports && declarationRange.text.includes('import ')) {
      // The declaration likely already has its own imports — skip
    }
  } else {
    // Target file doesn't exist yet — create it with the declaration
    edits.push({
      filePath: newModule,
      label: `create file and add declaration: ${elem.name}`,
      oldText: null,
      newText: declarationText + '\n',
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1,
    });
  }

  // 6. Update all importers of the moved symbol
  const importElements = store.queryElements({
    nameRegex: `^${elem.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
    kind: 'import',
    limit: 500,
  });

  for (const imp of importElements) {
    if (imp.module === sourceModule || imp.module === newModule) continue;

    const impContent = readFile(imp.module ?? '');
    if (!impContent) continue;

    // Find the import in the file and update its source path
    const fileImports = parseImports(impContent);
    for (const fileImp of fileImports) {
      // Check if this import references the old module
      if (fileImp.sourcePath.endsWith(filePathToModule(sourceModule).replace(/^\.\//, '')) ||
          fileImp.sourcePath === computeRelativeImportPath(imp.module ?? '', filePathToModule(sourceModule))) {
        const newImportPath = computeRelativeImportPath(imp.module ?? '', filePathToModule(newModule));
        const newImportText = formatNamedImport(fileImp.names, newImportPath, fileImp.isType);
        edits.push({
          filePath: imp.module ?? '',
          label: `update import path: ${fileImp.sourcePath} → ${newImportPath}`,
          oldText: fileImp.fullText.trim(),
          newText: newImportText,
          startLine: fileImp.startLine,
          startCol: fileImp.startCol,
          endLine: fileImp.endLine,
          endCol: fileImp.endCol,
        });
      }
    }
  }

  return { edits, warnings };
}