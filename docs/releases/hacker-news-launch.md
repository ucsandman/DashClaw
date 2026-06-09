# Hacker News Launch Packet

Prepared: 2026-06-09
Version: 4.7.9
Publish decision: do not publish SDKs for this launch prep pass. The shared version was bumped because platform source changed; SDK package metadata is synchronized, but SDK source did not change.

## HN-Ready Description

DashClaw is an open source governance runtime for AI agents. It sits between agents and the systems they can affect, evaluates actions before they execute, records the decision, and routes higher-risk work to human approval when needed.

The practical goal is simple: let agents keep useful autonomy without giving them unreviewed write access to production, customer data, deployment systems, or paid capabilities.

## Try The Demo

1. Run the local demo:

   ```bash
   npm install
   npm run demo
   ```

2. Open the URL printed by the command and use Mission Control to inspect actions, decisions, approvals, analytics, and diagnostics.

3. Expected proof:
   - `/mission-control` shows governed activity.
   - `/decisions` shows action records and guard outcomes.
   - `/approvals` shows any action that requires a human decision.
   - `/doctor` explains readiness issues with likely cause and next action.

## Self-Host Path

1. Copy the example environment file and fill placeholders:

   ```bash
   cp .env.example .env
   ```

2. Run setup and readiness checks:

   ```bash
   npm run setup
   npm run doctor
   npm run production:check
   ```

3. Connect one agent:

   ```bash
   npm install dashclaw
   ```

   Then point the SDK, MCP connector, Claude Code hook, or another supported integration at your DashClaw instance.

4. Expected production proof:
   - `npm run production:check` exits 0.
   - `dashclaw doctor` exits 0 or names the blocker.
   - A low-risk agent action appears in `/decisions`.
   - A high-risk action either blocks or appears in `/approvals`.

## Verification Evidence

Recent production-readiness evidence lives under:

- `.supergoal/take-this-codebase-and-make-it-productio-EYkzo5/evidence/phase-1/`
- `.supergoal/take-this-codebase-and-make-it-productio-EYkzo5/evidence/phase-4/`
- `.supergoal/take-this-codebase-and-make-it-productio-EYkzo5/evidence/phase-6/`
- `.supergoal/take-this-codebase-and-make-it-productio-EYkzo5/evidence/phase-7/`

Phase 7 visual/accessibility/performance summary:

- 12 desktop/mobile route checks across public, setup, doctor, Mission Control, and analytics surfaces.
- 0 axe violations.
- 0 unexpected console errors.
- 0 horizontal overflow pages.
- 0 unlabeled buttons, links, or images.
- Production local perf evidence captured for `/`, `/connect`, `/setup`, and `/mission-control`.

Final gate command set:

- `npm run lint`
- `npm run typecheck`
- `npx vitest run`
- `npm run build`
- `npm run contracts:check`
- `npm run docs:check`
- `npm run openapi:check`
- `npm run api:inventory:check`
- `npm run route-sql:check`
- `npm run version:check`
- `npm run version:sync:check`
- `npm run scripts:check-syntax`
- `npm run test:smoke`
- `npm audit --omit=dev --audit-level=moderate`

## Known Limits

- DashClaw governs actions routed through its SDKs, MCP connector, hooks, or API. It does not automatically control tools that bypass the runtime.
- The hosted public deployment is a demo surface; production teams should self-host or deploy their own governed instance.
- Discord and Telegram approvals require separate bot/app setup before they can receive real approval events.
- DashClaw records decisions and evidence, but formal compliance sign-off still belongs to the operator's compliance process.
- Model/provider IDs and pricing can drift; refresh provider/pricing data before wiring new production providers.

## Operator Checklist

- Fill `.env` from `.env.example`; do not commit secrets.
- Run `npm run production:check` before sharing a deployment.
- Run `npm run doctor` after deploy and after any env/provider change.
- Confirm `ALLOWED_ORIGIN`, `NEXTAUTH_URL`, database, Redis/SSE, and approval surfaces match the deployment URL.
- Connect one low-risk action and one approval-required action before inviting users.
- Keep SDK publication separate from platform-only releases unless SDK source changed.
