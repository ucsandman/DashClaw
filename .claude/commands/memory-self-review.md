---
description: Mine recent agent history (claude-mem + usage stats) for recurring failures and repeated patterns, audit MEMORY.md health, and PROPOSE (never apply) CLAUDE.md/memory edits for human approval.
argument-hint: "[days, default 7]"
model: sonnet
---

You are running DashClaw's **self-improvement loop**. Your job is to turn the last $1 (default 7) days of agent history into a small, concrete set of PROPOSED improvements to the operator's persistent instructions and memory. This is **human-gated**: you PROPOSE, you do NOT edit `CLAUDE.md`, `MEMORY.md`, or any memory/settings file. The operator reviews and applies.

Keep it cheap and tight — this should be a short, scannable proposal, not an essay.

## 1. Memory health check
- Read `C:\Users\sandm\.claude\projects\C--Projects-DashClaw\memory\MEMORY.md`; report its size vs the ~24.4KB cap. If it's over ~20KB, identify the longest index entries and the inline paragraphs that should move into their own topic file (the index must stay a lean pointer list — see `reference_memory_system_boundary.md`).
- Flag memory files whose status reads as finished history (e.g. "SHIPPED", "RESOLVED", "LANDED on main") that could be demoted to a terse one-line pointer to keep recall sharp.

## 2. Mine recent history (read-only)
- Use the claude-mem MCP (`mcp-search`: `search`, `timeline`, `get_observations`) to scan the last $1 days for: repeated corrections from the operator, the same bug class recurring, repeated tool sequences that could be a workflow, and tasks that stalled or were redone.
- Skim `C:\Users\sandm\.claude\stats-cache.json` for shifts in volume, model mix (Opus vs Sonnet/Haiku share), and effort that suggest a routing or cost-discipline tweak.
- Be evidence-based: only surface a pattern you can point to (cite session ids / observation ids / dates). A pattern must appear **3+ times** to become a proposed rule. Do not invent patterns to look thorough.

## 3. Propose (do not apply)
For each finding, write a proposal block:
```
FINDING: <what recurred>  (evidence: <ids/dates>, seen Nx)
PROPOSED CHANGE: <exact edit — which file, which section, the literal line to add/change>
RATIONALE: <why this prevents the recurrence>
```
Prefer the smallest durable change: a new one-line rule in the right CLAUDE.md, a new/updated memory file, or a MEMORY.md trim. If something is better solved by a new subagent or workflow than a rule, say so.

## 4. Output
End with: (a) a `MEMORY.md health: OK | NEEDS TRIM (N KB)` line, (b) the proposal blocks ranked by leverage, and (c) the explicit note: "Nothing was edited — apply the approved items yourself or tell me which to apply." If invoked headlessly (cron), additionally write the full proposal to `docs/superpowers/memory-self-review-PROPOSAL.md` (overwrite) so the operator can read it later; that file is a proposal, not an applied change.

If there is nothing worth changing, say so plainly and stop — a quiet week is a valid result.
