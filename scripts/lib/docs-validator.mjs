import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFilePromise = promisify(execFileCallback);

export const EXCLUDED_DIRS = new Set(['.git', '.next', 'node_modules', '.vercel', 'graphify-pilot']);
export const DOC_EXT = '.md';

export async function collectTrackedMarkdownFiles({
  root,
  execFile = execFilePromise,
  fileExists = pathExists,
}) {
  const { stdout } = await execFile(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
    { cwd: root, windowsHide: true },
  );

  const candidates = [...new Set(stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => file.toLowerCase().endsWith(DOC_EXT))
    .filter((file) => !file.split(/[\\/]/).some((segment) => EXCLUDED_DIRS.has(segment))))];

  const files = await Promise.all(candidates.map(async (file) => {
    const absolute = path.join(root, file);
    return await fileExists(absolute) ? absolute : null;
  }));
  return files.filter(Boolean);
}

function isExternalLink(link) {
  return /^(?:[a-z]+:|mailto:|tel:)/i.test(link);
}

function normalizeLinkTarget(rawTarget) {
  let target = rawTarget.trim();
  if (!target) return target;

  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }

  if (!target.startsWith('http') && /\s+"/.test(target)) {
    target = target.split(/\s+"/, 1)[0];
  }

  return target;
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function stripFencedCodeBlocks(content) {
  return content.replace(/^`{3,}[^\n]*\n[\s\S]*?^`{3,}\s*$/gm, '');
}

export async function validateLinks(root, markdownFile, content) {
  const errors = [];
  const regex = /!?\[[^\]]*]\(([^)]+)\)/g;
  const fileDir = path.dirname(markdownFile);
  content = stripFencedCodeBlocks(content);
  let match;

  while ((match = regex.exec(content)) !== null) {
    const rawTarget = match[1];
    const target = normalizeLinkTarget(rawTarget);
    if (!target || target.startsWith('#') || isExternalLink(target)) continue;

    const [pathPart] = target.split('#');
    if (!pathPart) continue;

    const cleanPath = pathPart.split('?')[0];
    if (!cleanPath) continue;

    if (cleanPath.startsWith('/') && !path.extname(cleanPath)) continue;

    const resolved = cleanPath.startsWith('/')
      ? path.join(root, cleanPath.slice(1))
      : path.resolve(fileDir, cleanPath);

    const existsDirect = await pathExists(resolved);
    const existsMarkdown = await pathExists(`${resolved}.md`);
    if (existsDirect || existsMarkdown) continue;

    errors.push(`${path.relative(root, markdownFile)} -> ${target}`);
  }

  return errors;
}

export function extractNextJsMajor(pkgJson) {
  const nextVersion = pkgJson.dependencies?.next || pkgJson.devDependencies?.next;
  if (!nextVersion) {
    throw new Error('Could not find next version in package.json');
  }

  const majorMatch = String(nextVersion).match(/(\d+)/);
  if (!majorMatch) {
    throw new Error(`Could not parse Next.js major from version: ${nextVersion}`);
  }

  return Number(majorMatch[1]);
}

export function validateNextVersionMentions(root, filePath, content, expectedMajor) {
  const errors = [];
  const regex = /Next\.js\s+(\d+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const foundMajor = Number(match[1]);
    if (foundMajor !== expectedMajor) {
      errors.push(
        `${path.relative(root, filePath)} -> mentions Next.js ${foundMajor}, expected Next.js ${expectedMajor}`,
      );
    }
  }

  return errors;
}
