/**
 * @dashclaw/openclaw-plugin
 *
 * OpenClaw plugin that routes every tool call through DashClaw governance:
 *   1. `before_tool_call` → `guard()` + optional `waitForApproval()` +
 *      `createAction()` to open a governance record.
 *   2. `after_tool_call`  → `updateOutcome()` to close that record.
 *
 * x402 capability payments (e.g. an `agentcash fetch`) take a dedicated path:
 * `before_tool_call` gates them with `action_type:'x402_purchase'` (so an
 * `x402_spend_limit` policy can block an over-budget payment before it runs),
 * and `after_tool_call` records the settled spend via `recordPurchase()` +
 * `recordPurchaseResult()`. The agent still executes the payment itself
 * (govern-not-do); DashClaw only guards and records it.
 *
 * Type accuracy notes (verified against `openclaw` plugin SDK types):
 *   - `PluginHookBeforeToolCallResult` uses `blockReason`, not `reason`.
 *   - `PluginKind` is `"memory" | "context-engine"` — neither applies to this
 *     generic hook plugin, so the manifest and `definePluginEntry` call both
 *     omit `kind`.
 *   - Event/context field shapes come from `PluginHookBeforeToolCallEvent`,
 *     `PluginHookAfterToolCallEvent`, and `PluginHookToolContext`. No
 *     defensive fallbacks for alternative field names are needed.
 *
 * The DashClaw client is cached at module scope and rebuilt only when the
 * resolved config key changes, mirroring the pattern used by OpenClaw's
 * bundled MemOS plugin.
 */
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
declare const pluginEntry: ReturnType<typeof definePluginEntry>;
export default pluginEntry;
