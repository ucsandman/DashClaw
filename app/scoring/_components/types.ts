// Shared types + constants for the Scoring page and its tab components,
// extracted from page.tsx in the page-hotspot decomposition.

export interface ScoringDimension {
  id?: string;
  name: string;
  data_source: string;
  weight: number;
  scale?: any[];
  data_config?: Record<string, any>;
}

export interface ScoringProfile {
  id: string;
  name: string;
  description?: string;
  action_type?: string | null;
  composite_method?: string;
  status?: string;
  dimensions?: ScoringDimension[];
}

export interface RiskRule {
  condition: string;
  add: number;
}

export interface RiskTemplate {
  id: string;
  name: string;
  description?: string;
  action_type?: string | null;
  base_risk?: number;
  rules?: RiskRule[];
}

export interface DimensionScore {
  dimension_name: string;
  score?: number | null;
  label?: string;
  raw_value?: number | string | null;
  weight?: number | null;
}

export interface ScoreRecord {
  id: string;
  profile_name?: string;
  profile_id?: string;
  action_id?: string;
  composite_score: number;
  dimension_scores?: DimensionScore[];
}

export interface NewProfileState {
  name: string;
  description: string;
  action_type: string;
  composite_method: string;
  dimensions: ScoringDimension[];
}

export interface NewTemplateState {
  name: string;
  description: string;
  action_type: string;
  base_risk: number;
  rules: RiskRule[];
}

export interface CalibrateFormState {
  action_type: string;
  lookback_days: number;
  agent_id: string;
  metrics: string[];
}

export interface NewDimState {
  name: string;
  data_source: string;
  weight: number;
}

export interface ScoreSummaryState {
  profileId: string;
  summary?: { scored?: number; total?: number; avg_score?: number | string };
  error?: string;
}

// NOTE: 'eval_score' was removed from this list — eval results live in the
// separate eval_scores table and are never joined onto the action objects the
// page scores, so that dimension always graded "no_data". Re-add only once the
// scoring path actually joins eval scores per action.
export const DATA_SOURCES = [
  { value: 'duration_ms', label: 'Duration (ms)' },
  { value: 'cost_estimate', label: 'Cost Estimate' },
  { value: 'tokens_total', label: 'Total Tokens' },
  { value: 'risk_score', label: 'Risk Score' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'metadata_field', label: 'Metadata Field' },
  { value: 'custom_function', label: 'Custom Function' },
];

export const COMPOSITE_METHODS = [
  { value: 'weighted_average', label: 'Weighted Average', desc: 'Sum of (score x weight) across dimensions' },
  { value: 'minimum', label: 'Minimum', desc: 'Lowest dimension score wins (strictest)' },
  { value: 'geometric_mean', label: 'Geometric Mean', desc: 'Balanced  --  penalizes zeros heavily' },
];

// Metrics auto-calibrate can analyze (matches autoCalibrate's default set).
export const CALIBRATE_METRICS = ['duration_ms', 'cost_estimate', 'tokens_total', 'risk_score', 'confidence'];
