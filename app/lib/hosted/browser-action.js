// The agent id the v5.2 guided first-action card on /connect sends with the
// browser-driven governed action. Shared here (plain .js — Turbopack won't
// map extensionless .js→.ts imports from .jsx importers) so both the client
// card and the server-side funnel can agree on it:
//   - app/connect/FirstGovernedActionCard.jsx re-exports it as
//     FIRST_ACTION_AGENT_ID (the synthetic-exclusion pin test guards it).
//   - hosted-workspace.repository.ts uses it to annotate whether an org's
//     first governed action came through the browser or an agent (v5.3).
// Renaming it to anything matching a synthetic pattern silently vanishes
// browser activations from the funnel — keep the pin test.
export const BROWSER_FIRST_ACTION_AGENT_ID = 'browser-first-action';

// The card's held preset: a force-push over main, which the catastrophe-only
// Short List seeded into every hosted trial holds for approval (pinned in
// catastrophe-only-pack.test.js). Simulated: the guard only grades the act,
// nothing is pushed.
export const BROWSER_HELD_ACTION = {
  action_type: 'connect.first_action',
  declared_goal: 'Force-push over main (simulated: nothing is pushed)',
  act: { kind: 'shell', command: 'git push --force origin main' },
};
