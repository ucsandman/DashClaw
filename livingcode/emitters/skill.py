"""Skill emitter — generates a fresh platform-intelligence skill markdown file.

Consumers run `python -m livingcode emit skill` (optionally with --output) to
regenerate the skill whenever DashClaw changes. The skill contains a snapshot
of the current shape plus instructions to prefer live queries.
"""

from livingcode.types import ShapeModel

# Public API. `emit_skill` is dispatched dynamically by `python -m livingcode
# emit skill` (livingcode/emit.py), so per-file dead-code scanners can't see the
# call site — declaring it here marks it used.
__all__ = ["emit_skill"]


def _group_routes_by_category(shape: ShapeModel) -> dict[str, list]:
    """Group active routes by their first path segment after /api/."""
    groups: dict[str, list] = {}
    for r in shape.routes:
        if r.archived:
            continue
        parts = r.path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "api":
            category = parts[1]
            groups.setdefault(category, []).append(r)
    return groups


def emit_skill(shape: ShapeModel) -> str:
    """Render the shape model as a platform-intelligence skill markdown file."""
    # Count on the same basis as docs/api-inventory.json: the NextAuth
    # catch-all handler is framework plumbing, not a governable API route.
    governable = [r for r in shape.routes if "[...nextauth]" not in r.path]
    active = [r for r in governable if not r.archived]
    required_env = sorted(
        [e for e in shape.env_vars if e.required], key=lambda e: e.name
    )
    optional_env = sorted(
        [e for e in shape.env_vars if not e.required], key=lambda e: e.name
    )
    route_groups = _group_routes_by_category(shape)

    lines: list[str] = []

    # Frontmatter
    lines += [
        "---",
        "name: dashclaw-platform-intelligence",
        "description: DashClaw platform expert for integration, troubleshooting, and governance. "
        "Snapshot-based — prefer live queries via `python -m livingcode query`, or `GET "
        "{baseUrl}/api/doctor` when Python/livingcode/the repo are unavailable.",
        "---",
        "",
        "# DashClaw Platform Intelligence",
        "",
        f"**Shape snapshot:** `{shape.timestamp}`",
        "**This file is auto-generated.** Do not edit by hand — regenerate with:",
        "",
        "```bash",
        "python -m livingcode emit skill --output <path-to-SKILL.md>",
        "```",
        "",
        "## Prefer Live Queries",
        "",
        "The facts below are a snapshot. Before answering any question about DashClaw's current",
        "structure, routes, env vars, or schema — run a live query:",
        "",
        "```bash",
        "python -m livingcode query summary     # High-level shape",
        "python -m livingcode query routes      # Current API surface",
        "python -m livingcode query env         # Current env vars",
        "python -m livingcode query tables      # Current schema",
        "python -m livingcode query all --json  # Full machine-readable shape",
        "```",
        "",
        "If the snapshot below disagrees with a live query, **trust the live query**.",
        "",
        "### Fallback: no Python, livingcode, or repo checkout",
        "",
        "`python -m livingcode` only works where the livingcode package and the repo",
        "checkout are present (e.g. a developer machine). In OpenClaw / the Claude app",
        "neither exists. When you cannot run the queries above, fall back **in this order**:",
        "",
        "1. **`GET {baseUrl}/api/doctor`** — live route/shape health straight from the running",
        "   instance. Requires the workspace API key (`x-api-key: <key>`); returns 401/403",
        "   without it. This is the authoritative live source when the CLI is unavailable.",
        "2. **Read the committed static shape** if a repo checkout is reachable:",
        "   `app/lib/doctor/generated/shape.json` (full machine-readable shape) and",
        "   `docs/api-inventory.json` (route inventory). These are regenerated on every",
        "   `npm run livingcode:refresh`, so they track the same facts the queries return.",
        "3. **Otherwise, treat the snapshot in this SKILL.md as authoritative** — it is the",
        "   best available source when neither the API nor the repo can be reached.",
        "",
        "## At a Glance",
        "",
        f"- **{len(active)}** active API routes across **{len(route_groups)}** categories"
        f" ({len(governable)} total including archived)",
        f"- **{len(required_env)}** required + **{len(optional_env)}** optional environment variables",
        f"- **{len(shape.tables)}** database tables",
        "",
    ]

    # API surface
    lines += ["## API Surface", ""]
    for category in sorted(route_groups.keys()):
        routes = sorted(route_groups[category], key=lambda r: r.path)
        lines.append(f"### `{category}`")
        lines.append("")
        for r in routes:
            methods = ", ".join(r.methods) if r.methods else "-"
            lines.append(f"- `{methods}` `{r.path}`")
        lines.append("")

    # Required env vars
    lines += ["## Required Environment Variables", ""]
    lines += [
        "These must be set — DashClaw will fail to start without them.",
        "",
    ]
    for e in required_env:
        doc = "" if e.in_env_example else " *(undocumented in .env.example)*"
        lines.append(f"- **`{e.name}`** - referenced in {len(e.files)} file(s){doc}")
    lines.append("")

    # Optional env vars
    lines += ["## Optional Environment Variables", ""]
    lines += [
        "These have fallbacks or only activate specific features.",
        "",
    ]
    for e in optional_env:
        doc = "" if e.in_env_example else " *(undocumented)*"
        lines.append(f"- `{e.name}`{doc}")
    lines.append("")

    # Tables
    lines += ["## Database Tables", ""]
    lines += [
        f"All {len(shape.tables)} tables defined in `schema/schema.js` (Drizzle ORM):",
        "",
    ]
    for t in shape.tables:
        lines.append(f"- `{t.name}`")
    lines.append("")

    # Configuration knobs (VALID_SETTING_KEYS, grouped by section)
    if getattr(shape, "setting_keys", []):
        lines += ["## Configuration Knobs", ""]
        lines += [
            "Per-org settings stored in the `settings` table. Set via "
            "`PUT /api/settings/:key` or the web Settings/Integrations UI. Keys "
            "marked sensitive are auto-encrypted at rest.",
            "",
        ]
        by_section: dict[str | None, list] = {}
        for s in shape.setting_keys:
            by_section.setdefault(s.section, []).append(s)
        # Render sections in the order they appear in the source file. We
        # approximate that by walking shape.setting_keys once and emitting
        # each section header the first time its key shows up.
        emitted_sections: set[str | None] = set()
        for s in shape.setting_keys:
            if s.section in emitted_sections:
                continue
            emitted_sections.add(s.section)
            header = s.section or "Uncategorized"
            lines.append(f"### {header}")
            lines.append("")
            for item in by_section[s.section]:
                lines.append(f"- `{item.name}`")
            lines.append("")

    # Realtime / webhook events
    if getattr(shape, "events", []):
        lines += ["## Realtime & Webhook Events", ""]
        lines += [
            "Every mutation that Mission Control reflects and every webhook "
            "delivery is keyed on these event strings. Subscribe via "
            "`GET /api/events` (SSE) or register a webhook with the matching "
            "`events: [...]` array.",
            "",
            "| Constant | Event |",
            "| --- | --- |",
        ]
        for e in sorted(shape.events, key=lambda x: x.event):
            lines.append(f"| `{e.constant}` | `{e.event}` |")
        lines.append("")

    # Signal vocabulary — types emitted by alerters, consumed by webhooks + adapters
    if getattr(shape, "signal_types", []):
        lines += ["## Signal Types", ""]
        lines += [
            "These are the `type` strings emitted through `fireWebhooksForOrg` "
            "and `deliverNativeNotifications`. Webhooks can subscribe to any "
            "subset by putting the type in their `events: [...]` array (or "
            "use `['all']` for everything).",
            "",
        ]
        for t in shape.signal_types:
            lines.append(f"- `{t}`")
        lines.append("")

    # Native notification adapters
    if getattr(shape, "adapters", []):
        lines += ["## Native Notification Adapters", ""]
        lines += [
            "Each adapter delivers `integration_mismatch`, "
            "`integration_health_changed`, and `cost_exceeded` signals when at "
            "least one of its required credential keys is configured. Per-"
            "channel opt-out via `DASHCLAW_ALERTS_<NAME>=false`.",
            "",
            "| Adapter | Required credential (any one) |",
            "| --- | --- |",
        ]
        for a in shape.adapters:
            keys = ", ".join(f"`{k}`" for k in a.required_keys) or "—"
            lines.append(f"| `{a.name}` | {keys} |")
        lines.append("")

    # Stale detection
    lines += [
        "## Detecting Drift",
        "",
        "To check whether this snapshot matches the current codebase:",
        "",
        "```bash",
        "python -m livingcode diff",
        "```",
        "",
        "If the diff shows changes, this skill is stale — regenerate it.",
    ]

    return "\n".join(lines) + "\n"
