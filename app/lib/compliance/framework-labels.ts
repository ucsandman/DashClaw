// Human display labels for the compliance frameworks that actually exist as
// definition files under app/lib/compliance/frameworks/<id>.json.
//
// DRIFT GUARD: every key here MUST have a matching framework JSON on disk —
// __tests__/unit/compliance-framework-drift.guard.test.js enforces it (the
// 'eu-ai-act' label once pointed at a framework with no definition file, so
// exports emitted "Framework not found. Skipping.").
export const FRAMEWORK_LABELS: Record<string, string> = {
  'soc2': 'SOC 2',
  'iso27001': 'ISO 27001',
  'nist-ai-rmf': 'NIST AI RMF',
  'gdpr': 'GDPR',
  'imda-agentic': 'IMDA Agentic AI',
};

export function frameworkLabel(id: string): string {
  return FRAMEWORK_LABELS[id] || id;
}
