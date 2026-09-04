#!/usr/bin/env node
// scripts/simplify-invariants.mjs — snapshot the behavioural invariants that the
// simplification rounds (docs/simplify/) must leave byte-identical. Run it on
// main and on the round branch, then `diff -r` the two output directories.
//
//   node --import tsx scripts/simplify-invariants.mjs --out <dir>
//
// Files written (each deterministic for a given tree):
//   contracts.sha256      docs/openapi/**, contracts/**, docs/api-inventory.{json,md}, drizzle/*.sql, schema/schema.js
//   mcp-tools.json        every MCP tool (governance + stdio sets): name, title, description, input schema
//   sdk-node-exports.json CJS + ESM export names and DashClaw prototype/namespace method names
//   sdk-python-exports.json  __all__ and public DashClaw attributes
//   cli-help.txt          `dashclaw --help` plus every subcommand's --help
//   guard-calibration.json  computeRiskScore / classifyAct+evidenceTotal over the golden vectors
//   hooks/<hook>.<case>.txt  stdout + exit code of each hooks/*.py on fixed stdin payloads, server unreachable
//   doc-counts.txt        `node scripts/check-doc-counts.mjs` output
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args[args.indexOf('--out') + 1] || 'docs/simplify/.invariants');
fs.mkdirSync(OUT, { recursive: true });
const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true }); fs.writeFileSync(path.join(OUT, name), text); };
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x), 2) + '\n';
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, shell: process.platform === 'win32' && /^(npm|npx)$/.test(cmd), ...opts });

// 1. contracts
{
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else files.push(p); } };
  walk('docs/openapi'); walk('drizzle'); walk('contracts');
  files.push('docs/api-inventory.json', 'docs/api-inventory.md', 'schema/schema.js');
  const lines = files.filter((f) => /\.(json|sql|js|md)$/.test(f)).sort().map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')}  ${f}`);
  write('contracts.sha256', lines.join('\n') + '\n');
}

// 2. MCP tools: register both sets on an in-memory server and list them through the protocol.
{
  const sdkDir = path.join(ROOT, 'mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm');
  const { McpServer } = await import(pathToFileURL(path.join(sdkDir, 'server/mcp.js')).href);
  const { Client } = await import(pathToFileURL(path.join(sdkDir, 'client/index.js')).href);
  const { InMemoryTransport } = await import(pathToFileURL(path.join(sdkDir, 'inMemory.js')).href);
  const serverMod = await import(pathToFileURL(path.join(ROOT, 'mcp-server/src/server.ts')).href);
  const toolsMod = await import(pathToFileURL(path.join(ROOT, 'mcp-server/src/tools/index.ts')).href);
  const { DashClawClient } = await import(pathToFileURL(path.join(ROOT, 'mcp-server/src/client.ts')).href);
  const { Store } = await import(pathToFileURL(path.join(ROOT, 'mcp-server/src/storage.ts')).href);
  const tmp = fs.mkdtempSync(path.join(OUT, 'mcp-store-'));
  const server = new McpServer({ name: 'snapshot', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
  serverMod.registerGovernance(server, new DashClawClient({ url: 'http://127.0.0.1:9', apiKey: 'snapshot', agentId: 'snapshot' }));
  toolsMod.registerTools(server, new Store({ home: tmp, state: path.join(tmp, 'state.json'), memory: path.join(tmp, 'memory.json'), audit: path.join(tmp, 'audit.log'), config: path.join(tmp, 'config.yaml') }));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'snapshot-client', version: '0.0.0' });
  await client.connect(ct);
  const tools = (await client.listTools()).tools.sort((a, b) => a.name.localeCompare(b.name));
  const resources = (await client.listResources().catch(() => ({ resources: [] }))).resources.sort((a, b) => a.uri.localeCompare(b.uri));
  await client.close(); await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  write('mcp-tools.json', stable({ tools, resources }));
}

// 3. SDK exports
{
  const cjs = require(path.join(ROOT, 'sdk/index.cjs'));
  const esm = await import(pathToFileURL(path.join(ROOT, 'sdk/dashclaw.js')).href);
  const proto = (cls) => Object.getOwnPropertyNames(cls.prototype).sort();
  const inst = new esm.DashClaw({ apiKey: 'snapshot', baseUrl: 'http://127.0.0.1:9', agentId: 'snapshot' });
  const namespaces = {};
  for (const k of Object.keys(inst)) {
    const v = inst[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) namespaces[k] = Object.keys(v).sort().map((n) => (v[n] && typeof v[n] === 'object' ? `${n}.{${Object.keys(v[n]).sort().join(',')}}` : n));
  }
  write('sdk-node-exports.json', stable({ cjs: Object.keys(cjs).sort(), esm: Object.keys(esm).sort(), DashClawPrototype: proto(esm.DashClaw), instanceNamespaces: namespaces, errorClasses: Object.keys(esm).filter((k) => /Error$/.test(k)).sort() }));
  const py = run('python', ['-c', 'import json,dashclaw\nfrom dashclaw import DashClaw\nprint(json.dumps({"__all__":sorted(dashclaw.__all__),"DashClaw":sorted(m for m in dir(DashClaw) if not m.startswith("_"))},indent=2))'], { env: { ...process.env, PYTHONPATH: path.join(ROOT, 'sdk-python') } });
  write('sdk-python-exports.json', (py.stdout || `ERROR\n${py.stderr}`) + '\n');
}

// 4. CLI help
{
  const cli = path.join(ROOT, 'cli/bin/dashclaw.js');
  const top = run('node', [cli, '--help']);
  const subs = [...new Set([...top.stdout.matchAll(/^\s{2}dashclaw ([a-z]+(?: [a-z]+)?)/gm)].map((m) => m[1]).filter((s) => s !== 'help'))];
  let text = `$ dashclaw --help (exit ${top.status})\n${top.stdout}${top.stderr}\n`;
  for (const s of subs) { const r = run('node', [cli, ...s.split(' '), '--help']); text += `\n$ dashclaw ${s} --help (exit ${r.status})\n${r.stdout}${r.stderr}\n`; }
  write('cli-help.txt', text.replace(/\x1b\[[0-9;]*m/g, ''));
}

// 5. guard calibration replay
{
  const guard = await import(pathToFileURL(path.join(ROOT, 'app/lib/guard.js')).href);
  const evidence = await import(pathToFileURL(path.join(ROOT, 'app/lib/guard/evidence.js')).href);
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, '__tests__/fixtures/risk-calibration-golden-vectors.json'), 'utf8'));
  const out = [];
  for (const v of fixture.vectors) {
    const row = { name: v.name, label: v.label };
    if (v.server_context) row.computeRiskScore = guard.computeRiskScore(v.server_context);
    if (v.bash_command) {
      const c = evidence.classifyAct({ kind: 'shell', command: v.bash_command });
      row.classifyAct = c; row.evidenceTotal = c ? evidence.evidenceTotal(c) : null;
    }
    out.push(row);
  }
  write('guard-calibration.json', stable(out));
}

// 6. hooks stdout on fixed payloads with the server unreachable
{
  const cases = {
    bash_echo: { tool_name: 'Bash', tool_input: { command: 'echo hello' }, tool_use_id: 'inv_001', session_id: 'invariants' },
    bash_rm: { tool_name: 'Bash', tool_input: { command: 'rm -rf build/' }, tool_use_id: 'inv_002', session_id: 'invariants' },
    bash_git_push: { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, tool_use_id: 'inv_003', session_id: 'invariants' },
    bash_curl_post: { tool_name: 'Bash', tool_input: { command: 'curl -X POST https://api.stripe.com/v1/charges -d amount=100' }, tool_use_id: 'inv_004', session_id: 'invariants' },
    write_env: { tool_name: 'Write', tool_input: { file_path: '/tmp/x/.env', content: 'A=1' }, tool_use_id: 'inv_005', session_id: 'invariants' },
    edit_src: { tool_name: 'Edit', tool_input: { file_path: 'app/lib/db.ts', old_string: 'a', new_string: 'b' }, tool_use_id: 'inv_006', session_id: 'invariants' },
    mcp_tool: { tool_name: 'mcp__github__create_pull_request', tool_input: { title: 'x' }, tool_use_id: 'inv_007', session_id: 'invariants' },
    stop: { session_id: 'invariants', stop_hook_active: false },
    post_bash: { tool_name: 'Bash', tool_input: { command: 'echo hello' }, tool_response: { stdout: 'hello', exit_code: 0 }, tool_use_id: 'inv_001', session_id: 'invariants' },
  };
  const hooks = { dashclaw_pretool: ['bash_echo', 'bash_rm', 'bash_git_push', 'bash_curl_post', 'write_env', 'edit_src', 'mcp_tool'], dashclaw_posttool: ['post_bash', 'bash_echo'], dashclaw_stop: ['stop'], dashclaw_db_containment: ['bash_echo', 'bash_rm'], enforcement_liveness_probe: ['stop'] };
  const env = { ...process.env, DASHCLAW_URL: 'http://127.0.0.1:9', DASHCLAW_API_KEY: 'invariants', DASHCLAW_AGENT_ID: 'invariants', DASHCLAW_GUARD_TIMEOUT: '1', DASHCLAW_GUARD_CONNECT_TIMEOUT: '1', DASHCLAW_GUARD_RETRIES: '0', DASHCLAW_DISABLE_DOTENV: '1', DASHCLAW_WORKSPACE: path.join(OUT, 'hook-ws'), HOME: path.join(OUT, 'hook-home'), USERPROFILE: path.join(OUT, 'hook-home'), PYTHONIOENCODING: 'utf-8' };
  for (const k of Object.keys(env)) if (/^DASHCLAW_/.test(k) && !(k in { DASHCLAW_URL: 1, DASHCLAW_API_KEY: 1, DASHCLAW_AGENT_ID: 1, DASHCLAW_GUARD_TIMEOUT: 1, DASHCLAW_GUARD_CONNECT_TIMEOUT: 1, DASHCLAW_GUARD_RETRIES: 1, DASHCLAW_DISABLE_DOTENV: 1, DASHCLAW_WORKSPACE: 1 })) delete env[k];
  fs.mkdirSync(env.HOME, { recursive: true }); fs.mkdirSync(env.DASHCLAW_WORKSPACE, { recursive: true });
  const norm = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>').replace(/\d+(\.\d+)?\s?ms/g, '<ms>').replace(/[A-Za-z]:\\[^\s"']+|\/[^\s"']*hook-(home|ws)[^\s"']*/g, '<path>');
  for (const [hook, names] of Object.entries(hooks)) for (const name of names) {
    const r = spawnSync('python', [path.join(ROOT, 'hooks', `${hook}.py`)], { cwd: ROOT, input: JSON.stringify(cases[name]), encoding: 'utf8', env, timeout: 30000 });
    write(`hooks/${hook}.${name}.txt`, `exit ${r.status}\n--- stdout ---\n${norm(r.stdout || '')}\n--- stderr ---\n${norm(r.stderr || '')}`);
  }
  fs.rmSync(env.HOME, { recursive: true, force: true }); fs.rmSync(env.DASHCLAW_WORKSPACE, { recursive: true, force: true });
}

// 7. documented counts
{
  const r = run('node', ['scripts/check-doc-counts.mjs']);
  write('doc-counts.txt', `exit ${r.status}\n${r.stdout}${r.stderr}`);
}

process.stdout.write(`invariants -> ${path.relative(ROOT, OUT)}: ${fs.readdirSync(OUT).length} entries\n`);
