export const RISK_CLASSES = ['low', 'medium', 'high', 'critical'];
export const AUTH_TYPES = ['none', 'bearer', 'api_key'];

export const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none';

// Starter templates for the register form — realistic provider shapes that
// pre-fill the form (no backend calls). risk_class + budget are the fields
// that actually feed the guard; endpoint/auth are descriptive metadata.
export interface RegistryTemplate {
  name: string;
  description: string;
  form: {
    name: string;
    endpoint: string;
    auth_type: string;
    risk_class: string;
    default_budget_usd: number | string;
  };
}

export const REGISTRY_TEMPLATES: RegistryTemplate[] = [
  {
    name: 'Enrichment API',
    description: 'Paid data-enrichment provider — medium risk, $2 per-call spend authority',
    form: { name: 'Enrichment API', endpoint: 'https://api.enrichment-provider.example.com', auth_type: 'bearer', risk_class: 'medium', default_budget_usd: 2 },
  },
  {
    name: 'Web search provider',
    description: 'Metered search endpoint — low risk, $0.05 per call',
    form: { name: 'Web search provider', endpoint: 'https://api.search-provider.example.com', auth_type: 'api_key', risk_class: 'low', default_budget_usd: 0.05 },
  },
  {
    name: 'Internal sub-agent',
    description: 'A sub-agent you operate — high risk (acts on your systems), no spend budget',
    form: { name: 'Internal sub-agent', endpoint: 'https://agent.internal.example.com', auth_type: 'none', risk_class: 'high', default_budget_usd: '' },
  },
];
