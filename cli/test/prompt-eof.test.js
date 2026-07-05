// cli/test/prompt-eof.test.js
//
// v5.4 outsider-run regression: stdin ending mid-prompt used to leave the
// ask()/askSecret() promises pending forever — node drained the event loop
// and exited 0 as if the command had succeeded, having installed nothing.
// These tests drive real child processes with piped stdin (the only way to
// reproduce process.stdin EOF behavior honestly).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configUrl = pathToFileURL(path.join(__dirname, '..', 'lib', 'config.js')).href;

function runChild(script, stdinText) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdinText) child.stdin.write(stdinText);
    child.stdin.end();
  });
}

describe('prompt EOF handling', () => {
  it('ask() rejects (not silent exit 0) when stdin closes unanswered', async () => {
    const script = `
      const { ask } = await import(${JSON.stringify(configUrl)});
      try { await ask('q: '); console.log('ANSWERED'); }
      catch (e) { console.error('REJECTED: ' + e.message); process.exit(3); }
    `;
    const r = await runChild(script, '');
    assert.equal(r.code, 3, `expected rejection exit, got code=${r.code} stdout=${r.stdout}`);
    assert.match(r.stderr, /stdin closed before the prompt was answered/);
  });

  it('ask() then askSecret() with a single piped line rejects instead of exiting 0 silently', async () => {
    // The original failure: readline consumes the whole piped buffer for the
    // first prompt; the secret prompt then waits on a stream that has ended.
    const script = `
      const { ask, askSecret } = await import(${JSON.stringify(configUrl)});
      try {
        const first = await ask('url: ');
        const second = await askSecret('key: ');
        console.log('ANSWERED ' + first + ' ' + second);
      } catch (e) { console.error('REJECTED: ' + e.message); process.exit(3); }
    `;
    const r = await runChild(script, 'https://example.com\n');
    assert.equal(r.code, 3, `expected rejection exit, got code=${r.code} stdout=${r.stdout}`);
    assert.match(r.stderr, /stdin closed before the prompt was answered/);
  });

  it('askSecret() still resolves normally when the answer arrives before EOF', async () => {
    const script = `
      const { askSecret } = await import(${JSON.stringify(configUrl)});
      const v = await askSecret('key: ');
      console.log('GOT:' + v);
    `;
    const r = await runChild(script, 'oc_live_abc\n');
    assert.equal(r.code, 0, `stderr=${r.stderr}`);
    assert.match(r.stdout, /GOT:oc_live_abc/);
  });
});
