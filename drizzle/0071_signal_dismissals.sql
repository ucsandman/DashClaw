-- Server-side signal dismissals. Dismissed occurrences previously lived ONLY
-- in browser localStorage (dashclaw_dismissed_signals), so the SystemStatusBar
-- counts disagreed with every server-computed surface (/api/widget/pulse
-- showed 262 red while the banner showed 159) and with other browsers.
-- computeSignals now subtracts this table's keys for the org, so every
-- consumer (banner, signals panel, widget pulse, guard warnings, signals
-- cron) sees the same set. dismiss_key is the per-occurrence signalDismissKey
-- (type:agent:action:loop:assumption:detected_at) — a NEW occurrence of the
-- same condition produces a new key and re-fires.
CREATE TABLE IF NOT EXISTS signal_dismissals (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  dismiss_key TEXT NOT NULL,
  dismissed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_dismissals_org_key_unique
ON signal_dismissals (org_id, dismiss_key);
