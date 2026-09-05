// CLAUDE.md: every entry point must surface async rejections.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

function pem(label, bytes) {
  const body = Buffer.from(bytes).toString('base64').match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function parseArgs(argv) {
  const agentId = argv[0];
  if (!agentId) {
    throw new Error('Usage: node scripts/generate-agent-keys.mjs <agent-id> [--output-dir <directory>]');
  }
  let outputDir = 'agent-keys';
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] !== '--output-dir' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
    outputDir = argv[index + 1];
    index += 1;
  }
  return { agentId, outputDir: resolve(outputDir) };
}

async function assertMissing(paths) {
  for (const path of paths) {
    try {
      await access(path, fsConstants.F_OK);
      throw new Error(`Refusing to overwrite existing key file: ${path}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function generateIdentity() {
  const { agentId, outputDir } = parseArgs(process.argv.slice(2));
  const privatePath = resolve(outputDir, 'private_key.pem');
  const publicPath = resolve(outputDir, 'public_key.pem');

  await mkdir(outputDir, { recursive: true });
  await assertMissing([privatePath, publicPath]);

  console.log(`Generating RSASSA-PKCS1-v1_5 2048-bit keypair for agent: ${agentId}...`);
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  const [privatePkcs8, publicSpki] = await Promise.all([
    webcrypto.subtle.exportKey('pkcs8', privateKey),
    webcrypto.subtle.exportKey('spki', publicKey),
  ]);
  await Promise.all([
    writeFile(privatePath, pem('PRIVATE KEY', privatePkcs8), { mode: 0o600, flag: 'wx' }),
    writeFile(publicPath, pem('PUBLIC KEY', publicSpki), { mode: 0o644, flag: 'wx' }),
  ]);

  console.log(`\nPrivate key written to: ${privatePath}`);
  console.log(`Public key written to:  ${publicPath}`);
  console.log('\nPython SDK RSA action signing: load private_key.pem with serialization.load_pem_private_key, then pass private_key= to DashClaw.');
  console.log('Register or pair public_key.pem with the same agent ID before enabling signature enforcement.');
  console.log('\nNode SDK verified identity: use the supported JWKS-backed JWT constructor option:');
  console.log("const claw = new DashClaw({ baseUrl, apiKey, agentId, authToken: process.env.DASHCLAW_AGENT_JWT });");
  console.log('The Node SDK does not accept an RSA private-key constructor option.');
}

generateIdentity().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
