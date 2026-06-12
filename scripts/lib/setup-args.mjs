// Parsed by scripts/setup.mjs AND unit-testable in isolation.
export function parseSetupArgs(argv) {
  const out = { yes: false, databaseUrl: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') out.yes = true;
    else if (a === '--json') out.json = true;
    else if (a === '--database-url') {
      const v = argv[++i];
      if (!v || !v.startsWith('postgresql://')) {
        throw new Error('--database-url must be a postgresql:// connection string');
      }
      out.databaseUrl = v;
    }
  }
  return out;
}
