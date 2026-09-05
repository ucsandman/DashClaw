#!/usr/bin/env node

const { execSync, spawn } = require('node:child_process');

const IMAGE = 'ghcr.io/ucsandman/dashclaw-demo:latest';

console.log('DashClaw Demo\n');

// Check Docker is available
try {
  execSync('docker info', { stdio: 'ignore' });
} catch (e) {
  console.error('Docker is required to run the DashClaw demo.');
  console.error('Install Docker Desktop: https://www.docker.com/products/docker-desktop/');
  console.error('Then re-run: npx dashclaw-demo');
  process.exit(1);
}

// Pull the latest image
console.log('Pulling DashClaw demo image...');
execSync(`docker pull ${IMAGE}`, { stdio: 'inherit' });

console.log('\nStarting DashClaw demo on http://localhost:3000 ...\n');

const container = spawn('docker', [
  'run', '--rm',
  '-p', '3000:3000',
  '-e', 'DASHCLAW_MODE=demo',
  '-e', 'NEXT_PUBLIC_DASHCLAW_MODE=demo',
  IMAGE,
], { stdio: ['ignore', 'pipe', 'pipe'] });

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  container.kill('SIGTERM');
  console.log('\nDemo stopped.');
  process.exit(0);
});

let buffer = '';

container.stdout.on('data', (data) => {
  buffer += data.toString();
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx);
    buffer = buffer.slice(newlineIdx + 1);

    process.stdout.write(line + '\n');
  }
});

container.stderr.on('data', (data) => {
  process.stderr.write(data);
});

container.on('close', (code) => {
  // Flush remaining buffer
  if (buffer.length > 0) {
    process.stdout.write(buffer + '\n');
  }
  console.log('\nDemo stopped.');
  process.exit(code || 0);
});
