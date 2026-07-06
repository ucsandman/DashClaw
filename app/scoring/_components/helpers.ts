// Score color bands for the Scoring page (80/60/40), extracted from
// page.tsx so the bands are unit-testable.

export function scoreColor(score: number): string {
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-warning';
  if (score >= 40) return 'text-brand';
  return 'text-error';
}

export function scoreBg(score: number): string {
  if (score >= 80) return 'bg-success-subtle';
  if (score >= 60) return 'bg-status-warning/20';
  if (score >= 40) return 'bg-brand/20';
  return 'bg-error-subtle';
}
