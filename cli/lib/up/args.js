const DB_MODES = ['docker', 'embedded', 'url'];

export function parseUpArgs(argv) {
  const out = { update: false, yes: false, noBrowser: false, db: null, dir: null, port: null, sourceDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') out.update = true;
    else if (a === '--yes') out.yes = true;
    else if (a === '--no-browser') out.noBrowser = true;
    else if (a === '--db') {
      const v = argv[++i];
      if (!DB_MODES.includes(v)) throw new Error(`--db must be one of: ${DB_MODES.join(', ')} (docker, embedded, url)`);
      out.db = v;
    } else if (a === '--dir') out.dir = argv[++i] ?? null;
    else if (a === '--source-dir') out.sourceDir = argv[++i] ?? null;
    else if (a === '--port') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error('--port must be an integer 1-65535');
      out.port = v;
    }
  }
  return out;
}
