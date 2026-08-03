process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Pre-commit gate: lint the staged JS/TS files, and typecheck the project when
// any staged file is .ts/.tsx (vitest transpiles without type-checking, so a
// commit can pass tests and still break the build). Exits fast when no
// staged file is lintable, so docs/python commits pay only the node spawn.
import { execFileSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
  encoding: 'utf8',
})
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

const lintable = staged.filter((f) => /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(f));
const hasTypescript = staged.some((f) => /\.(ts|tsx)$/.test(f));

if (lintable.length === 0) {
  console.log('lint-typecheck: no staged JS/TS files, skipping');
  process.exit(0);
}

function run(label, args) {
  try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
  } catch (err) {
    console.error(`\nlint-typecheck: ${label} failed — fix the errors above, then re-commit.`);
    process.exit(err.status ?? 1);
  }
}

// --no-warn-ignored: staged files covered by eslint ignores (generated
// artifacts, mirrors) are silently skipped instead of erroring.
console.log(`lint-typecheck: eslint on ${lintable.length} staged file(s)`);
run('eslint', ['node_modules/eslint/bin/eslint.js', '--no-warn-ignored', ...lintable]);

if (hasTypescript) {
  console.log('lint-typecheck: staged .ts/.tsx present, running tsc --noEmit');
  run('tsc --noEmit', ['node_modules/typescript/bin/tsc', '--noEmit']);
}

console.log('lint-typecheck: ok');
