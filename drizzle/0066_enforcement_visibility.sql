-- F0 enforcement visibility (governance gap audit 2026-08-05): a hook in
-- DASHCLAW_HOOK_MODE=observe logs a block verdict and lets the tool call
-- proceed. The ledger recorded those rows identically to enforced blocks,
-- which is how 153 blocks read as "enforcement works" while enforcement was
-- off machine-wide.
--
-- enforcement_mode: the client's enforcement posture at decision time
-- ('enforce' | 'observe'), threaded from the hook payload on the create
-- paths. NULL = unreported (SDKs, MCP, older hooks) — never assume observe.
--
-- executed_despite: PostToolUse witness that a gated action executed anyway
-- ('block' | 'require_approval'). Stamped by the posttool hook when the
-- pretool verdict should have stopped the call but the tool ran (observe
-- mode, or a bypass). NULL = no execution witnessed.
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS enforcement_mode TEXT;
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS executed_despite TEXT;
