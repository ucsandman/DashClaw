#!/usr/bin/env node
/**
 * Refresh DEFAULT_PRICING (app/lib/billing.js) and PRICES_PER_MTOK
 * (app/lib/claude-code/pricing.js) from LiteLLM's community-maintained
 * pricing JSON.
 *
 * Provider pricing pages (Anthropic, OpenAI, Google) are HTML with no
 * machine-readable feed. LiteLLM tracks every major provider in a single
 * JSON at:
 *
 *   https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 *
 * which is the de-facto source of truth used across the LLM observability
 * ecosystem (Helicone, Langfuse, LiteLLM proxy, OpenRouter mappers).
 *
 * Usage:
 *   npm run pricing:refresh                       # dry-run, print diff summary
 *   npm run pricing:refresh:apply                 # write the new tables
 *   node scripts/refresh-model-pricing.mjs --json # output the raw extracted table
 *
 * The script operates on `MODEL_PRICING_GENERATED:START` / `:END` marker
 * comments in each source file — anything outside the markers (FALLBACK
 * constants, unversioned defaults, surrounding logic) is left untouched.
 *
 * Models DashClaw knows about live in `REGISTRY` below. For each, list
 * the LiteLLM keys that would be acceptable canonical sources in priority
 * order. The script picks the first match and converts per-token rates
 * to per-million.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const PER_MILLION = 1_000_000;

// DashClaw model registry. Per pattern, list LiteLLM keys to try in priority
// order; the script takes the first match. Date-stamped keys come first
// because LiteLLM keeps both stamped and aliased entries — the stamped one
// is the authoritative rate.
export const REGISTRY = {
  // Anthropic Claude family. Cache rates follow the family rule
  // (cache_write = 1.25x input; cache_read = 0.10x input). Opus 4.5/4.6/4.7/4.8
  // share rates ($5/$25); only Opus 4.1 still carries the legacy $15/$75.
  // Fable 5 sits ABOVE the opus rows: billing.ts matches by ordered substring,
  // and REGISTRY insertion order is the generated block's order.
  'fable-5': { label: 'Claude Fable 5', candidates: ['claude-fable-5'] },
  'opus-4-8': { label: 'Claude Opus 4.8', candidates: ['claude-opus-4-8', 'claude-opus-4-5'] },
  'opus-4-7': { label: 'Claude Opus 4.7', candidates: ['claude-opus-4-7-20260101', 'claude-opus-4-7', 'claude-opus-4-5'] },
  'opus-4-6': { label: 'Claude Opus 4.6', candidates: ['claude-opus-4-6-20251201', 'claude-opus-4-6', 'claude-opus-4-5'] },
  'opus-4-5': { label: 'Claude Opus 4.5', candidates: ['claude-opus-4-5-20250805', 'claude-opus-4-5'] },
  'opus-4-1': { label: 'Claude Opus 4.1 (legacy)', candidates: ['claude-opus-4-1-20250805', 'claude-opus-4-1', 'claude-3-opus-20240229'] },
  'sonnet-4-6': { label: 'Claude Sonnet 4.6', candidates: ['claude-sonnet-4-6-20251215', 'claude-sonnet-4-6', 'claude-sonnet-4-5'] },
  'sonnet-4-5': { label: 'Claude Sonnet 4.5', candidates: ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'] },
  'haiku-4-5': { label: 'Claude Haiku 4.5', candidates: ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'] },
  // OpenAI. Ordered most-specific FIRST within each family: estimateCost does
  // ordered substring matching (m.includes(pattern)), so 'gpt-5.5-pro' must
  // precede 'gpt-5.5', and mini/nano/pro variants must precede their base
  // pattern or they silently price at the base rate.
  'gpt-5.5-pro': { label: 'GPT-5.5 Pro', candidates: ['gpt-5.5-pro-2026-04-23', 'gpt-5.5-pro'] },
  'gpt-5.5': { label: 'GPT-5.5', candidates: ['gpt-5.5-2026-04-23', 'gpt-5.5'] },
  'gpt-5.4-pro': { label: 'GPT-5.4 Pro', candidates: ['gpt-5.4-pro-2026-03-05', 'gpt-5.4-pro'] },
  'gpt-5.4-mini': { label: 'GPT-5.4 Mini', candidates: ['gpt-5.4-mini-2026-03-17', 'gpt-5.4-mini'] },
  'gpt-5.4-nano': { label: 'GPT-5.4 Nano', candidates: ['gpt-5.4-nano-2026-03-17', 'gpt-5.4-nano'] },
  'gpt-5.4': { label: 'GPT-5.4', candidates: ['gpt-5.4-2026-03-05', 'gpt-5.4'] },
  'gpt-4.1-mini': { label: 'GPT-4.1 Mini', candidates: ['gpt-4.1-mini-2025-04-14', 'gpt-4.1-mini'] },
  'gpt-4.1-nano': { label: 'GPT-4.1 Nano', candidates: ['gpt-4.1-nano-2025-04-14', 'gpt-4.1-nano'] },
  'gpt-4.1': { label: 'GPT-4.1', candidates: ['gpt-4.1-2025-04-14', 'gpt-4.1'] },
  'gpt-4o-mini': { label: 'GPT-4o Mini', candidates: ['gpt-4o-mini-2024-07-18', 'gpt-4o-mini'] },
  'gpt-4o': { label: 'GPT-4o', candidates: ['gpt-4o-2024-08-06', 'gpt-4o'] },
  'o3-pro': { label: 'o3-pro', candidates: ['o3-pro-2025-06-10', 'o3-pro'] },
  'o3-mini': { label: 'o3-mini', candidates: ['o3-mini-2025-01-31', 'o3-mini'] },
  'o4-mini': { label: 'o4-mini', candidates: ['o4-mini-2025-04-16', 'o4-mini'] },
  'o3': { label: 'o3', candidates: ['o3-2025-04-16', 'o3'] },
  // Google
  'gemini-2.5-pro': { label: 'Gemini 2.5 Pro', candidates: ['gemini/gemini-2.5-pro', 'gemini-2.5-pro'] },
  'gemini-2.5-flash': { label: 'Gemini 2.5 Flash', candidates: ['gemini/gemini-2.5-flash', 'gemini-2.5-flash'] },
};

// Unversioned-default rows in billing.js — these stay hand-curated and point
// at the latest in family by convention. The script does NOT touch them.
const UNVERSIONED_DEFAULTS = ['opus', 'sonnet', 'haiku'];

function round(n) {
  // Round to 4 decimals to match Anthropic's published precision; LiteLLM's
  // per-token rates can have float noise on the last digit.
  return Math.round(Number(n) * 1e4) / 1e4;
}

export function ratesForPattern(litellm, candidates) {
  for (const key of candidates) {
    const e = litellm[key];
    if (!e) continue;
    const input = (Number(e.input_cost_per_token) || 0) * PER_MILLION;
    const output = (Number(e.output_cost_per_token) || 0) * PER_MILLION;
    const cache_write =
      (Number(e.cache_creation_input_token_cost) || 0) * PER_MILLION;
    const cache_read =
      (Number(e.cache_read_input_token_cost) || 0) * PER_MILLION;
    if (input === 0 && output === 0) continue; // skip placeholder/embedding-only entries
    return {
      sourceKey: key,
      input: round(input),
      output: round(output),
      cache_write: round(cache_write),
      cache_read: round(cache_read),
    };
  }
  return null;
}

export function buildPricingTables(litellm) {
  const billing = [];
  const claudeCode = {};
  const skipped = [];
  for (const [pattern, info] of Object.entries(REGISTRY)) {
    const rates = ratesForPattern(litellm, info.candidates);
    if (!rates) {
      skipped.push({ pattern, candidates: info.candidates });
      continue;
    }
    billing.push({
      pattern,
      label: info.label,
      input: rates.input,
      output: rates.output,
      cache_write: rates.cache_write,
      cache_read: rates.cache_read,
      _source: rates.sourceKey,
    });
    // claude-code pricing.js uses 'claude-<pattern>' as canonical key for
    // Anthropic models. Non-Anthropic patterns aren't in pricing.js.
    if (pattern.startsWith('opus') || pattern.startsWith('sonnet') || pattern.startsWith('haiku') || pattern.startsWith('fable')) {
      claudeCode[`claude-${pattern}`] = {
        input: rates.input,
        output: rates.output,
        cache_write: rates.cache_write,
        cache_read: rates.cache_read,
        _source: rates.sourceKey,
      };
      // Opus 4-7 / 4-8 and Fable 5 ship a [1m] long-context variant; mirror
      // its rate (the in-the-wild fable id is `claude-fable-5[1m]`).
      if (pattern === 'opus-4-7' || pattern === 'opus-4-8' || pattern === 'fable-5') {
        claudeCode[`claude-${pattern}[1m]`] = { ...claudeCode[`claude-${pattern}`] };
      }
      // Haiku 4-5 has a date-stamped variant; mirror.
      if (pattern === 'haiku-4-5') {
        claudeCode['claude-haiku-4-5-20251001'] = { ...claudeCode['claude-haiku-4-5'] };
      }
    }
  }
  return { billing, claudeCode, skipped };
}

function formatBillingArray(entries) {
  // Render the billing.js DEFAULT_PRICING block. Keeps the column-aligned
  // shape so diffs are readable.
  const lines = entries.map(e => {
    const cols = [
      `pattern: '${e.pattern}'`,
      `label: '${e.label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
      `input: ${e.input}`,
      `output: ${e.output}`,
      `cache_write: ${e.cache_write}`,
      `cache_read: ${e.cache_read}`,
    ].join(', ');
    return `  { ${cols} }, // ${e._source}`;
  });
  return lines.join('\n');
}

function formatPricingObject(obj) {
  // Render PRICES_PER_MTOK object body (without the surrounding braces).
  const lines = [];
  for (const [key, rates] of Object.entries(obj)) {
    const padKey = `'${key}'`.padEnd(32, ' ');
    lines.push(
      `  ${padKey}: { input: ${rates.input.toFixed(2)}, output: ${rates.output.toFixed(2)}, cache_write: ${rates.cache_write.toFixed(2)}, cache_read: ${rates.cache_read.toFixed(2)} }, // ${rates._source}`
    );
  }
  return lines.join('\n');
}

export function replaceBlock(source, label, replacement) {
  const start = `// MODEL_PRICING_GENERATED:${label}:START`;
  const end = `// MODEL_PRICING_GENERATED:${label}:END`;
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Markers ${start} / ${end} not found in source. Add them around the auto-generated block first.`);
  }
  const before = source.slice(0, startIdx + start.length);
  const after = source.slice(endIdx);
  return `${before}\n${replacement}\n${after}`;
}

function diffSummary(oldRates, newRates) {
  const changes = [];
  const all = new Set([...Object.keys(oldRates), ...Object.keys(newRates)]);
  for (const k of [...all].sort()) {
    const o = oldRates[k];
    const n = newRates[k];
    if (!n) { changes.push(`  - ${k}: REMOVED`); continue; }
    if (!o) { changes.push(`  + ${k}: ADDED (input=${n.input}, output=${n.output})`); continue; }
    const fields = ['input', 'output', 'cache_write', 'cache_read'];
    const f = fields.filter(field => Math.abs((o[field] || 0) - (n[field] || 0)) > 1e-6);
    if (f.length) {
      const parts = f.map(field => `${field} ${o[field] || 0}→${n[field] || 0}`).join('; ');
      changes.push(`  ~ ${k}: ${parts}`);
    }
  }
  return changes;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const emitJson = args.includes('--json');

  console.log(`Fetching LiteLLM pricing from ${LITELLM_URL}...`);
  const res = await fetch(LITELLM_URL);
  if (!res.ok) {
    console.error(`LiteLLM fetch failed: HTTP ${res.status}`);
    process.exit(2);
  }
  const litellm = await res.json();
  console.log(`Loaded ${Object.keys(litellm).length} LiteLLM entries.`);

  const { billing, claudeCode, skipped } = buildPricingTables(litellm);
  console.log(`Mapped ${billing.length} billing.js patterns; ${Object.keys(claudeCode).length} pricing.js keys.`);
  if (skipped.length) {
    console.warn(`\nSkipped ${skipped.length} pattern(s) — no LiteLLM match found:`);
    for (const s of skipped) console.warn(`  - ${s.pattern} (tried: ${s.candidates.join(', ')})`);
  }

  if (emitJson) {
    process.stdout.write(JSON.stringify({ billing, claudeCode, skipped }, null, 2));
    return;
  }

  // Read current files and compute diffs.
  // Pricing modules are TypeScript (migrated); the marker-block rewrite is
  // extension-agnostic — only these paths and the exact MODEL_PRICING_GENERATED
  // marker strings matter.
  const billingPath = path.join(REPO_ROOT, 'app', 'lib', 'billing.ts');
  const pricingPath = path.join(REPO_ROOT, 'app', 'lib', 'claude-code', 'pricing.ts');
  const billingSrc = fs.readFileSync(billingPath, 'utf8');
  const pricingSrc = fs.readFileSync(pricingPath, 'utf8');

  // Print a rough diff (per-pattern rate changes) for the operator.
  // Restrict comparison to patterns that live inside the marker block — the
  // script only regenerates those, so hand-curated rows below the markers
  // (codex, llama, family defaults) shouldn't appear as 'removed'.
  const oldBilling = extractRatesFromSource(billingSrc, /\{\s*pattern:\s*'([^']+)'[^}]*input:\s*([\d.]+)[^}]*output:\s*([\d.]+)(?:[^}]*cache_write:\s*([\d.]+))?(?:[^}]*cache_read:\s*([\d.]+))?[^}]*\}/g);
  const registryPatterns = new Set(Object.keys(REGISTRY));
  for (const k of Object.keys(oldBilling)) {
    if (!registryPatterns.has(k)) delete oldBilling[k];
  }
  const newBilling = Object.fromEntries(billing.map(b => [b.pattern, b]));
  const changes = diffSummary(oldBilling, newBilling);

  console.log('\nbilling.js DEFAULT_PRICING changes:');
  if (!changes.length) console.log('  (no changes)');
  else for (const c of changes) console.log(c);

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to write the new tables.');
    return;
  }

  const newBillingBlock = formatBillingArray(billing);
  const newPricingBlock = formatPricingObject(claudeCode);

  const newBillingSrc = replaceBlock(billingSrc, 'BILLING', newBillingBlock);
  const newPricingSrc = replaceBlock(pricingSrc, 'PRICING', newPricingBlock);

  fs.writeFileSync(billingPath, newBillingSrc, 'utf8');
  fs.writeFileSync(pricingPath, newPricingSrc, 'utf8');
  console.log(`\nWrote ${billingPath}`);
  console.log(`Wrote ${pricingPath}`);
  console.log('\nReview the diff, run the test suite, and commit if everything looks right.');
}

function extractRatesFromSource(src, re) {
  const out = {};
  for (const m of src.matchAll(re)) {
    out[m[1]] = {
      input: Number(m[2]) || 0,
      output: Number(m[3]) || 0,
      cache_write: Number(m[4]) || 0,
      cache_read: Number(m[5]) || 0,
    };
  }
  return out;
}

// Module side: only execute when called as a script, not when imported by
// tests.
const isMain = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
