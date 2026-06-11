/**
 * Machine-level DASHCLAW_* env must never leak into tests. The developer
 * machine exports a real DASHCLAW_URL / DASHCLAW_API_KEY globally; a test
 * that resolves config from the inherited environment would otherwise talk
 * to a LIVE DashClaw server. Strip every DASHCLAW_-prefixed key before each
 * test file runs; tests and helpers then set exactly what they need.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith("DASHCLAW_")) delete process.env[key];
}
