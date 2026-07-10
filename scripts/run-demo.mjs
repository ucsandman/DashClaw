import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

const DASHCLAW_MODE = 'demo';
const DASHCLAW_PORT = process.env.PORT || 3000;
const DASHCLAW_BASE_URL = `http://localhost:${DASHCLAW_PORT}`;

async function waitReady(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch (e) {
      // Ignore connection errors during startup
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  console.log('  DashClaw 1-Minute Governance Test');
  console.log('  =================================\n');

  console.log('[1/4] Starting DashClaw in demo mode...');
  
  // Use 'npm run dev' to start the app. 
  // We set DASHCLAW_MODE=demo to bypass database requirements.
  const app = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'ignore', // Keep it quiet to reduce noise
    shell: true,
    env: {
      ...process.env,
      DASHCLAW_MODE,
      NEXT_PUBLIC_DASHCLAW_MODE: DASHCLAW_MODE,
      PORT: DASHCLAW_PORT.toString(),
      // Ensure no real database is tried in case .env exists
      DATABASE_URL: '', 
    }
  });

  // Handle cleanup on exit to prevent orphaned servers
  const cleanup = () => {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${app.pid} /T /F 2>nul`);
      } else {
        app.kill('SIGINT');
      }
    } catch (e) {
      // process already dead
    }
  };
  
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(); });
  process.on('SIGTERM', () => { cleanup(); process.exit(); });

  console.log('[2/4] Waiting for runtime to be ready...');
  const ready = await waitReady(DASHCLAW_BASE_URL);

  if (!ready) {
    console.error('❌ Error: DashClaw failed to start within 60 seconds.');
    cleanup();
    process.exit(1);
  }

  // Ensure example dependencies are installed (specifically the linked SDK)
  const exampleDir = join(ROOT, 'examples', 'openai-governed-agent');
  console.log('[3/4] Ensuring example agent environment is ready...');
  await new Promise((resolve) => {
    const install = spawn('npm', ['install'], { cwd: exampleDir, stdio: 'ignore', shell: true });
    install.on('close', resolve);
  });

  console.log('[4/4] Running governed agent action...');
  console.log('');

  const agentScript = join(ROOT, 'examples', 'openai-governed-agent', 'index.js');
  const agent = spawn('node', [agentScript], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    env: {
      ...process.env,
      DASHCLAW_BASE_URL,
      DASHCLAW_API_KEY: 'demo-key', // Any key works in demo/dev mode
    }
  });

  let agentOutput = '';

  agent.stdout.on('data', (data) => {
    const text = data.toString();
    agentOutput += text;
    process.stdout.write(text);
  });

  agent.stderr.on('data', (data) => {
    const text = data.toString();
    agentOutput += text;
    process.stderr.write(text);
  });

  agent.on('close', (code) => {
    console.log('');
    if (code === 0) {
      console.log('✅ Demo completed successfully.');
      console.log('   The agent action was governed by DashClaw policies.');
      console.log(`\n======================================================`);
      console.log(`🚀 DashClaw is still running!`);
      
      // Extract the replay URL from the agent's output
      const urlMatch = agentOutput.match(new RegExp(`${DASHCLAW_BASE_URL}/replay/[a-zA-Z0-9_]+`));
      const replayUrl = urlMatch ? urlMatch[0] : `${DASHCLAW_BASE_URL}/approvals`;

      console.log(`   Opening Decision Replay...`);
      console.log(`   Replay: ${replayUrl}`);
      console.log(`\nDashClaw monitored and governed the agent action.`);
      console.log(`Inspect the decision evidence in your browser.`);
      console.log(`\nPress Ctrl+C to exit when you're done.`);
      console.log(`======================================================\n`);

      // Open browser cross-platform
      const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      try {
        execSync(`${startCmd} ${replayUrl}`);
      } catch (e) {
        console.log(`Could not automatically open browser. Please visit the link above.`);
      }

      // Keep the script running to prevent terminal from returning to prompt
      setInterval(() => {}, 1000 * 60 * 60); 
    } else {
      console.error(`❌ Example agent exited with code ${code}`);
      cleanup();
      process.exit(code);
    }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
