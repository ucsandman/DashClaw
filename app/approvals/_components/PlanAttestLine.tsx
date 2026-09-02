// Plan attestation readout (drizzle/0075) — shared by PlanReviewCard and
// LivePlansSection so the operator sees the same one-liner wherever a plan
// appears. Renders nothing until a runner has actually attested: a plan with
// attest_count 0 has no attestation story to tell, and an empty row would
// read as "checked, fine" (L2 — a verdict must carry the volume it processed).
export interface PlanAttestFields {
  plan_hash?: string | null;
  attest_count?: number | null;
  attested_at?: string | null;
  last_attest_result?: string | null;
}

// Past-tense twin of LivePlansSection's relativeUntil.
function relativeSince(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default function PlanAttestLine({ plan }: { plan: PlanAttestFields }) {
  const count = Number(plan.attest_count ?? 0);
  if (!count) return null;
  const result = plan.last_attest_result ?? 'unknown';
  // Same success/error split the status and preview chips use — 'ok' is the
  // only outcome that let a run proceed; every other reason failed it closed.
  const tone = result === 'ok' ? 'text-success' : 'text-error';
  return (
    <div className="text-xs text-tertiary" title="Attestations recorded at run start, before the agent's first model call">
      Attested {count}× · last {relativeSince(plan.attested_at)} · <span className={tone}>{result}</span>
    </div>
  );
}
