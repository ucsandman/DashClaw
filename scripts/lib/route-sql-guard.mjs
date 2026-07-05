import fs from 'node:fs/promises';
import path from 'node:path';

const PATTERNS = [
  {
    key: 'tagged_template',
    label: 'sql tagged template',
    // (?<![.\w]) keeps prose like `foo.sql` followed by a closing markdown
    // backtick in comments from counting as a tagged template.
    regex: /(?<![.\w])sql\s*`/g,
  },
  {
    key: 'query_call',
    label: 'sql.query call',
    regex: /\bsql\.query\s*\(/g,
  },
];

function getApiRoot(rootDir = process.cwd()) {
  return path.join(rootDir, 'app', 'api');
}

async function walkRouteFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === '_archive') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkRouteFiles(full)));
      continue;
    }
    if (entry.isFile() && /^route\.(js|ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function countLineMatches(line, regex) {
  let count = 0;
  const matcher = new RegExp(regex.source, regex.flags);
  while (matcher.exec(line) !== null) count++;
  return count;
}

function countUsage(source) {
  const counts = Object.fromEntries(PATTERNS.map((pattern) => [pattern.key, 0]));
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    for (const pattern of PATTERNS) {
      counts[pattern.key] += countLineMatches(line, pattern.regex);
    }
  }

  counts.total = PATTERNS.reduce((sum, pattern) => sum + counts[pattern.key], 0);
  return counts;
}

export function getRouteSqlBaselinePath(rootDir = process.cwd()) {
  return path.join(rootDir, 'docs', 'route-sql-baseline.json');
}

export async function scanRouteSqlUsage(rootDir = process.cwd()) {
  const apiRoot = getApiRoot(rootDir);
  const routeFiles = await walkRouteFiles(apiRoot);
  const files = [];

  for (const filePath of routeFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    const counts = countUsage(source);
    if (counts.total === 0) continue;

    files.push({
      file: path.relative(rootDir, filePath).replace(/\\/g, '/'),
      ...counts,
    });
  }

  // Use simple comparison (not localeCompare) for cross-platform determinism.
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  return {
    scope: 'app/api/**/route.js',
    patterns: PATTERNS.map(({ key, label }) => ({ key, label })),
    files_scanned: routeFiles.length,
    files_with_direct_sql: files.length,
    totals: {
      tagged_template: files.reduce((sum, item) => sum + item.tagged_template, 0),
      query_call: files.reduce((sum, item) => sum + item.query_call, 0),
      total: files.reduce((sum, item) => sum + item.total, 0),
    },
    files,
  };
}

export function serializeRouteSqlBaseline(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
