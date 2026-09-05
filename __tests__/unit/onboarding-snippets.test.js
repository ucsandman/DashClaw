/**
 * Guard against drift in the two highest-traffic onboarding code surfaces:
 *
 *   1. The "Copy Agent Connect Prompt" markdown at
 *      docs/prompts/dashclaw-agent-connect.md (served via
 *      /api/prompts/agent-connect/raw).
 *
 *   2. The Quick integration (Node.js) and Quick integration (Python)
 *      snippets rendered inline in app/self-host/SetupTabs.js step 5.
 *
 * Background: an audit on 2026-05-13 found the on-page Node snippet
 * importing the canonical 'dashclaw' package but calling APIs that exist
 * only on the DEPRECATED 'dashclaw/legacy' surface (removed in v5.0.0)
 * (guardMode constructor
 * option, scoreOutput/score_output methods, outputSummary/output_summary
 * outcome field, camelCase body fields). The snippet would not run as
 * written. This test pins the cleaned versions in place so the same
 * stale shape cannot quietly come back.
 *
 * If the canonical SDK ever re-introduces one of these names, update
 * BOTH the snippet and the matching assertion here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const repoRoot = resolve(__dirname, '..', '..');
const promptPath = resolve(repoRoot, 'docs/prompts/dashclaw-agent-connect.md');
const setupTabsPath = resolve(repoRoot, 'app/self-host/SetupTabs.tsx');

const promptText = readFileSync(promptPath, 'utf8');
const setupTabsText = readFileSync(setupTabsPath, 'utf8');

describe('onboarding snippet hygiene', () => {
  describe('docs/prompts/dashclaw-agent-connect.md', () => {
    it('teaches the governed helper and explains execution-claim uncertainty', () => {
      expect(promptText).toContain('claw.runGoverned(');
      expect(promptText).toContain('execution claims');
      expect(promptText).toContain('uncertain outcome confirmation');
    });

    it('does not use ` -- ` as a sentence break in CLI command bullets', () => {
      // " -- " in this position reads as an em-dash substitute and violates
      // the marketing copy rule. Use a colon or comma instead.
      const cliBlockMatch = promptText.match(/Commands:\n([\s\S]*?)\n\n/);
      expect(cliBlockMatch, 'expected a "Commands:" block in the prompt').toBeTruthy();
      expect(cliBlockMatch[1]).not.toMatch(/`\s+--\s+/);
    });

    it('does not reference legacy-only or phantom SDK names', () => {
      // guardMode: legacy v1 option only
      expect(promptText).not.toMatch(/\bguardMode\b/);
      // scoreOutput: never existed on canonical v2
      expect(promptText).not.toMatch(/\bscoreOutput\b/);
      // outputSummary: never an outcome field on canonical v2 (it is `summary`)
      expect(promptText).not.toMatch(/\boutputSummary\b/);
    });
  });

  describe('app/self-host/SetupTabs.js Quick integration snippets', () => {
    it('imports the canonical dashclaw package, not the legacy subpath', () => {
      expect(setupTabsText).toContain("from 'dashclaw'");
      expect(setupTabsText).not.toMatch(/from 'dashclaw\/legacy'/);
    });

    it('Node snippet does not pass guardMode to the constructor (legacy v1 only)', () => {
      expect(setupTabsText).not.toMatch(/\bguardMode\b/);
    });

    it('Node snippet does not call scoreOutput or use outputSummary (phantom APIs)', () => {
      expect(setupTabsText).not.toMatch(/\bscoreOutput\b/);
      expect(setupTabsText).not.toMatch(/\boutputSummary\b/);
    });

    it('Python snippet does not call score_output or use output_summary (phantom APIs)', () => {
      expect(setupTabsText).not.toMatch(/\bscore_output\b/);
      expect(setupTabsText).not.toMatch(/\boutput_summary\b/);
    });

    it('Python snippet drops guard_mode in favor of the explicit decision check', () => {
      // guard_mode is a real Python SDK option but the canonical teaching
      // pattern is explicit: read decision.decision, branch on "block".
      // If you re-add guard_mode here, also revisit the prompt so the two
      // onboarding surfaces stay aligned.
      expect(setupTabsText).not.toMatch(/\bguard_mode\b/);
    });

    it('uses snake_case body fields for guard and createAction (server expects snake_case)', () => {
      // These camelCase tokens were the v1-era field names and would not
      // match the server schema. The Node SDK passes the body through
      // unchanged, so callers MUST send snake_case.
      expect(setupTabsText).not.toMatch(/\bactionType:/);
      expect(setupTabsText).not.toMatch(/\bdeclaredGoal:/);
      expect(setupTabsText).not.toMatch(/\briskScore:/);
      // Positive assertions to lock in the right shape:
      expect(setupTabsText).toMatch(/\baction_type:\s*'deploy'/);
      expect(setupTabsText).toMatch(/\bdeclared_goal:\s*'Ship auth-service/);
      expect(setupTabsText).toMatch(/\brisk_score:\s*40/);
    });

    it('Node snippet teaches the canonical v2 finality path (reportActionSuccess)', () => {
      expect(setupTabsText).toContain('dc.reportActionSuccess(');
    });

    it('Python snippet teaches the canonical v2 finality path (report_action_success)', () => {
      expect(setupTabsText).toContain('dc.report_action_success(');
    });

    it('does not invent a content field on the guard call (not in the route schema)', () => {
      // app/api/guard/route.js accepts:
      //   { action_type, risk_score?, agent_id?, agent_name?, systems_touched?,
      //     reversible?, declared_goal? }
      // `content` is not in that list. A snippet calling guard with `content`
      // would silently drop the field.
      const guardCallMatches = setupTabsText.match(/\bguard\s*\(\s*\{[\s\S]*?\}\s*\)/g) || [];
      for (const call of guardCallMatches) {
        expect(call, 'guard() call should not include a content: field').not.toMatch(/\bcontent:/);
      }
    });
  });
});
