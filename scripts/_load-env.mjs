import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function loadEnvFile(filePath, { force = false, protectedKeys = new Set() } = {}) {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, 'utf8');
  content.split('\n').forEach(line => {
    const part = line.trim();
    if (!part || part.startsWith('#')) return;
    const [key, ...valueParts] = part.split('=');
    let value = valueParts.join('=').trim();
    
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      const trimmedKey = key.trim();
      // Values present before this loader ran came from the invoking process
      // (shell, CI, or provider configuration) and are authoritative. A
      // deliberate override is available for the rare script that explicitly
      // wants repository files to win.
      const currentValue = process.env[trimmedKey];
      const isPlaceholder = currentValue && currentValue.includes('<YOUR_');
      
      if (!currentValue || (!protectedKeys.has(trimmedKey) && (force || isPlaceholder))) {
        process.env[trimmedKey] = value;
      }
    }
  });
}

const protectedProcessKeys = new Set(
  Object.keys(process.env).filter((key) => Boolean(process.env[key])),
);
const allowFileOverride = process.env.DASHCLAW_ENV_FILE_OVERRIDE === '1';
const disableEnvFiles = process.env.DASHCLAW_ENV_FILE_DISABLE === '1';

// Load .env first (defaults), then .env.local (local refinements). Values
// explicitly supplied by the process win unless the caller deliberately sets
// DASHCLAW_ENV_FILE_OVERRIDE=1.
if (!disableEnvFiles) {
  loadEnvFile(resolve(projectRoot, '.env'), {
    force: allowFileOverride,
    protectedKeys: allowFileOverride ? new Set() : protectedProcessKeys,
  });
  loadEnvFile(resolve(projectRoot, '.env.local'), {
    force: true,
    protectedKeys: allowFileOverride ? new Set() : protectedProcessKeys,
  });
}

export const ENV_LOAD_REPORT = Object.freeze({
  databaseSource: protectedProcessKeys.has('DATABASE_URL') && !allowFileOverride
    ? 'process'
    : (process.env.DATABASE_URL && !disableEnvFiles ? 'file' : 'unset'),
  fileOverride: allowFileOverride,
  filesDisabled: disableEnvFiles,
});
