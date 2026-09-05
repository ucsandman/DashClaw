const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { Script } = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const SOURCE = readFileSync(require.resolve('../bin/dashclaw-demo.js'), 'utf8');

function runLauncher(stdoutChunks) {
  const processCalls = [];
  const writes = [];
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const container = new EventEmitter();
  container.stdout = stdout;
  container.stderr = stderr;
  container.kill = () => {};

  const fakeProcess = Object.create(process);
  Object.defineProperty(fakeProcess, 'platform', { value: 'linux' });
  Object.defineProperty(fakeProcess, 'stdout', {
    value: { write(value) { writes.push(String(value)); } },
  });
  Object.defineProperty(fakeProcess, 'stderr', { value: { write() {} } });
  Object.defineProperty(fakeProcess, 'on', { value() {} });
  Object.defineProperty(fakeProcess, 'exit', {
    value() { throw new Error('unexpected process.exit'); },
  });

  new Script(SOURCE, { filename: 'dashclaw-demo.js' }).runInNewContext({
    console: { log() {}, error() {} },
    module: { exports: {} },
    exports: {},
    process: fakeProcess,
    require(name) {
      if (name !== 'node:child_process') return require(name);
      return {
        execSync(command) {
          processCalls.push(command);
        },
        spawn(command) {
          processCalls.push(command);
          return container;
        },
      };
    },
  });

  for (const chunk of stdoutChunks) stdout.emit('data', Buffer.from(chunk));
  return { processCalls, output: writes.join('') };
}

test('prints a replay URL without starting another process', () => {
  const result = runLauncher(['REPLAY_URL=http://localhost:3000/replay/action_123\n']);

  assert.equal(
    result.processCalls.length,
    3,
    'only docker info, docker pull, and docker run should execute',
  );
  assert.equal(result.output, 'REPLAY_URL=http://localhost:3000/replay/action_123\n');
});

test('forwards complete lines when container output arrives in split chunks', () => {
  const result = runLauncher([
    'Demo ready\nREPLAY_',
    'URL=http://localhost:3000/demo\nPress Ctrl+C',
    ' to exit.\n',
  ]);

  assert.equal(
    result.output,
    'Demo ready\nREPLAY_URL=http://localhost:3000/demo\nPress Ctrl+C to exit.\n',
  );
});
