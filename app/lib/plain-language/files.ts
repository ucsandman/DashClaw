import { type PlainDescription, unknownDescription } from './types';

export interface FileIntel {
  sensitive_path?: boolean;
  traversal_detected?: boolean;
  outside_workspace?: boolean;
}

const MAX_PATH = 200;

/**
 * `_enrich_file` writes the literal string "unknown" when the tool input
 * carried no resolvable path. Treat that as no path at all rather than
 * describing a file called "unknown".
 */
const NO_PATH = 'unknown';

const FILE_HEADLINES: Readonly<Record<string, { headline: string; ruleId: string }>> = {
  // The hook cannot tell whether the target already exists, so we do not claim it.
  Write: { headline: 'Creates or replaces a file in your project.', ruleId: 'file.write' },
  Edit: { headline: 'Changes an existing file in your project.', ruleId: 'file.edit' },
  MultiEdit: { headline: 'Makes several changes to an existing file in your project.', ruleId: 'file.edit' },
  NotebookEdit: { headline: 'Changes a cell in a notebook file.', ruleId: 'file.edit' },
};

/** Fixed phrases only — no extracted text is ever woven into a warning. */
const SENSITIVE_WARNING = 'This file holds credentials or configuration.';
const TRAVERSAL_WARNING = 'This path reaches outside the folder it named.';
const OUTSIDE_WARNING = 'This file is outside your project folder.';

export function describeFile(label: string, path: string, fileIntel?: FileIntel): PlainDescription {
  const known = FILE_HEADLINES[label];
  if (!known) return unknownDescription('file.unregistered');
  if (!path || path === NO_PATH) return unknownDescription('file.no-path');

  // Worst first: credentials, then traversal, then location.
  const warnings: string[] = [];
  if (fileIntel?.sensitive_path) warnings.push(SENSITIVE_WARNING);
  if (fileIntel?.traversal_detected) warnings.push(TRAVERSAL_WARNING);
  if (fileIntel?.outside_workspace) warnings.push(OUTSIDE_WARNING);

  return {
    headline: known.headline,
    detail: path.length > MAX_PATH ? `${path.slice(0, MAX_PATH)}…` : path,
    warnings,
    confidence: 'high',
    // File edits are recoverable from version control; the hook agrees
    // (_enrich_file hardcodes reversible: True).
    reversible: true,
    ruleId: known.ruleId,
  };
}
