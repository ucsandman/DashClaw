#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  generateApiInventory,
  serializeApiInventoryJson,
  serializeApiInventoryMarkdown,
  getInventoryJsonPath,
  getInventoryMarkdownPath,
} from './generate-api-inventory.mjs';

async function readOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalize(str) {
  return str.replace(/\r\n/g, '\n');
}

async function main() {
  const rootDir = process.cwd();
  const inventory = await generateApiInventory(rootDir);

  const jsonPath = getInventoryJsonPath(rootDir);
  const mdPath = getInventoryMarkdownPath(rootDir);
  const actualJson = await readOrNull(jsonPath);
  const actualMd = await readOrNull(mdPath);

  // The Markdown artifact's `last-verified` date records WHEN it was last
  // regenerated, not WHAT routes exist — it is metadata, not inventory content.
  // The generator stamps it with the current date, so comparing a freshly
  // generated artifact against the committed one reports spurious drift on every
  // day after the artifact was committed (this reddened CI daily). Pin the
  // expected output to the committed date so only real structural changes fail.
  const committedVerified = actualMd?.match(/^last-verified:\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
  if (committedVerified) {
    process.env.API_INVENTORY_VERIFIED_DATE = committedVerified;
  }

  const expectedJson = serializeApiInventoryJson(inventory);
  const expectedMd = serializeApiInventoryMarkdown(inventory);

  const issues = [];
  if (actualJson == null) {
    issues.push(`missing file: ${path.relative(rootDir, jsonPath)}`);
  } else if (normalize(actualJson) !== normalize(expectedJson)) {
    issues.push(`out-of-date file: ${path.relative(rootDir, jsonPath)}`);
  }

  if (actualMd == null) {
    issues.push(`missing file: ${path.relative(rootDir, mdPath)}`);
  } else if (normalize(actualMd) !== normalize(expectedMd)) {
    issues.push(`out-of-date file: ${path.relative(rootDir, mdPath)}`);
  }

  if (issues.length > 0) {
    console.error('API inventory drift detected:');
    for (const issue of issues) console.error(`- ${issue}`);
    console.error('Run: npm run api:inventory:generate and commit the updated artifacts.');

    // Diagnostic: show first difference so cross-platform issues are debuggable.
    if (actualJson != null && normalize(actualJson) !== normalize(expectedJson)) {
      const a = normalize(actualJson);
      const b = normalize(expectedJson);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`JSON first diff at byte ${i}:`);
          console.error(`  committed: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}`);
          console.error(`  expected:  ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
          break;
        }
      }
    }
    if (actualMd != null && normalize(actualMd) !== normalize(expectedMd)) {
      const a = normalize(actualMd);
      const b = normalize(expectedMd);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`MD first diff at byte ${i}:`);
          console.error(`  committed: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}`);
          console.error(`  expected:  ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
          break;
        }
      }
    }

    process.exitCode = 1;
    return;
  }

  console.log('API inventory artifacts are up to date.');
}

main().catch((err) => {
  console.error(`API inventory check failed: ${err.message}`);
  process.exitCode = 1;
});
