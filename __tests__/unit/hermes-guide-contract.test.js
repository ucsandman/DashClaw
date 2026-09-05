import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as jsYaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const canonicalPath = path.join(repoRoot, 'plugins/dashclaw/.hermes-plugin/hermes_config_snippet.yaml');
const guidePath = path.join(repoRoot, 'app/guides/hermes/page.tsx');

function configuredCommands(config) {
  return Object.entries(config.hooks).flatMap(([event, entries]) =>
    entries.map(({ command }) => [event, command]),
  );
}

function guideManagedBlock(source) {
  const match = source.match(/const hermesConfigYamlBlock = `([\s\S]*?)`;/);
  expect(match, 'Hermes guide must contain its managed config block').not.toBeNull();
  return jsYaml.load(match[1].replace(/\\\$\{/g, '${'));
}

function repositoryScriptPath(command) {
  const script = command.match(/python (?:\\?\$\{DASHCLAW_REPO\}\/)?([^\s]+)/)?.[1];
  expect(script, `Expected a Python hook command: ${command}`).toBeTruthy();
  return path.join(repoRoot, script);
}

describe('Hermes guide managed config', () => {
  it('matches the canonical hook pairs and only references shipped scripts', () => {
    const canonical = jsYaml.load(readFileSync(canonicalPath, 'utf8'));
    const guide = guideManagedBlock(readFileSync(guidePath, 'utf8'));

    expect(configuredCommands(guide)).toEqual(configuredCommands(canonical));
    for (const [, command] of configuredCommands(guide)) {
      expect(existsSync(repositoryScriptPath(command)), command).toBe(true);
    }
  });
});
