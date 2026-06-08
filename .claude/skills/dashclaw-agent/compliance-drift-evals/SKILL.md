---
name: compliance-drift-evals
description: Set up compliance exports, drift detection, evaluations, scoring, and learning analytics
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: analytics
---

# Compliance, Drift, Evaluations & Learning

DashClaw's analytical capabilities for governance evidence, behavioral monitoring, and agent quality tracking.

---

## Compliance Exports

Generate audit-ready evidence bundles for regulatory frameworks.

### Supported Frameworks

| Framework | ID | Description |
|-----------|-----|-------------|
| SOC 2 | `soc2` | Service Organization Control |
| NIST AI RMF | `nist-ai-rmf` | AI Risk Management Framework |
| EU AI Act | `eu-ai-act` | European AI regulation |
| ISO 42001 | `iso42001` | AI Management System |

### Create an Export

```javascript
// V1 SDK
const exp = await claw.createComplianceExport({
  name: 'Q1 2026 SOC 2 Audit',
  frameworks: ['soc2'],
  format: 'json',        // or 'md'
  window_days: 90,
  include_evidence: true,
  include_remediation: true,
  include_trends: true
});
```

```bash
# API
curl -X POST "$DASHCLAW_BASE_URL/api/compliance/exports" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Q1 Audit","frameworks":["soc2"],"window_days":90}'
```

### Scheduled Exports

```javascript
await claw.createComplianceSchedule({
  name: 'Weekly SOC 2',
  frameworks: ['soc2'],
  cron_expression: '0 9 * * 1',  // Every Monday at 9am
  window_days: 7,
  include_evidence: true
});
```

### Gap Analysis

```javascript
const gaps = await claw.analyzeGaps('soc2');
// Returns: missing controls, partial coverage, recommendations
```

### Coverage Trends

```javascript
const trends = await claw.getComplianceTrends({ framework: 'soc2', limit: 12 });
// Monthly coverage scores over time
```

---

## Drift Detection

Statistical behavioral drift detection using z-scores. Pure math — no LLM required.

### 6 Tracked Metrics

| Metric | What It Measures |
|--------|-----------------|
| `risk_score` | Are actions getting riskier? |
| `confidence` | Is agent confidence dropping? |
| `duration_ms` | Are actions taking longer? |
| `cost_estimate` | Are costs increasing? |
| `tokens_total` | Is token usage growing? |
| `learning_score` | Is the agent learning? |

### Severity Thresholds

| z-score | Severity | Meaning |
|---------|----------|---------|
| ≥ 1.5 | info | Notable deviation |
| ≥ 2.0 | warning | Significant drift |
| ≥ 3.0 | critical | Severe anomaly |

### Compute Baselines

```javascript
// Establish baseline from last 30 days
await claw.computeDriftBaselines({
  agent_id: 'my-agent',
  lookback_days: 30
});
```

### Detect Drift

```javascript
const drift = await claw.detectDrift({
  agent_id: 'my-agent',
  window_days: 7
});

// drift.alerts: [{ metric, z_score, severity, current_value, baseline_mean }]
```

### Acknowledge Alerts

```javascript
await claw.acknowledgeDriftAlert(alertId);
```

### Monitor Drift Stats

```javascript
const stats = await claw.getDriftStats({ agent_id: 'my-agent' });
// { total_alerts, unacknowledged, by_severity, by_metric }
```

---

## Evaluations

Score agent outputs using 5 built-in scorer types.

### Scorer Types

| Type | LLM Required | Description |
|------|-------------|-------------|
| `regex` | No | Pattern matching against output |
| `contains` | No | Keyword/phrase detection |
| `numeric_range` | No | Value within expected range |
| `custom_function` | No | Arbitrary JavaScript logic |
| `llm_judge` | Yes (optional) | LLM-based quality assessment |

### Create a Scorer

```javascript
// Regex scorer — check for PII
await claw.createScorer({
  name: 'no-pii-in-output',
  scorerType: 'regex',
  config: {
    pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',  // SSN pattern
    invert: true  // Score 1 if NOT found (good)
  },
  description: 'Ensures no SSN patterns in output'
});

// Numeric range scorer
await claw.createScorer({
  name: 'response-time-check',
  scorerType: 'numeric_range',
  config: {
    field: 'duration_ms',
    min: 0,
    max: 5000
  }
});
```

### Score an Action

```javascript
await claw.createScore({
  actionId: 'ar_abc123',
  scorerName: 'no-pii-in-output',
  score: 1.0,        // 0-1 scale
  label: 'pass',
  reasoning: 'No PII patterns detected'
});
```

### Batch Evaluation Run

```javascript
const run = await claw.createEvalRun({
  name: 'Weekly quality check',
  scorerId: 'sc_abc123',
  actionFilters: { days: 7 }
});
// Scores all matching actions from the last 7 days
```

---

## Scoring Profiles

Multi-dimensional risk and quality scoring with auto-calibration.

### Create a Profile

```javascript
await claw.createScoringProfile({
  name: 'deploy-quality',
  description: 'Quality scoring for deployment actions',
  composite_method: 'weighted_average',  // or: minimum, geometric_mean
  dimensions: [
    {
      name: 'risk',
      weight: 0.4,
      source: 'risk_score',
      scale: [
        { min: 0, max: 40, label: 'low', score: 1.0 },
        { min: 40, max: 70, label: 'medium', score: 0.6 },
        { min: 70, max: 100, label: 'high', score: 0.2 }
      ]
    },
    {
      name: 'speed',
      weight: 0.3,
      source: 'duration_ms',
      scale: [
        { min: 0, max: 5000, label: 'fast', score: 1.0 },
        { min: 5000, max: 30000, label: 'normal', score: 0.7 },
        { min: 30000, max: null, label: 'slow', score: 0.3 }
      ]
    },
    {
      name: 'cost',
      weight: 0.3,
      source: 'cost_estimate',
      scale: [
        { min: 0, max: 1, label: 'cheap', score: 1.0 },
        { min: 1, max: 10, label: 'moderate', score: 0.6 },
        { min: 10, max: null, label: 'expensive', score: 0.2 }
      ]
    }
  ]
});
```

### Auto-Calibration

```javascript
const suggestions = await claw.autoCalibrate({
  lookback_days: 30
});
// Returns percentile-based scale suggestions from historical data
```

### Risk Templates

Replace hardcoded risk scores with rule-based computation:

```javascript
await claw.createRiskTemplate({
  name: 'deploy-risk',
  base_risk: 50,
  rules: [
    { field: 'systems_touched', operator: 'contains', value: 'production', add: 30 },
    { field: 'reversible', operator: '==', value: false, add: 20 },
    { field: 'metadata.has_rollback', operator: '==', value: true, add: -15 }
  ]
});
```

---

## Learning Analytics

Track agent improvement over time. DashClaw's unique moat.

### Maturity Model

| Level | Episodes | Success Rate | Avg Score |
|-------|----------|-------------|-----------|
| Novice | 0+ | any | any |
| Developing | 10+ | 40%+ | 40+ |
| Competent | 50+ | 60%+ | 55+ |
| Proficient | 150+ | 75%+ | 65+ |
| Expert | 500+ | 85%+ | 75+ |
| Master | 1000+ | 92%+ | 85+ |

### Compute Learning Velocity

```javascript
const velocity = await claw.computeLearningVelocity({
  agent_id: 'my-agent',
  lookback_days: 90,
  period: 'weekly'
});
// Linear regression slope of performance over time
```

### Learning Curves

```javascript
const curves = await claw.computeLearningCurves({
  agent_id: 'my-agent',
  lookback_days: 180
});
// Per-action-type learning curves showing improvement trajectory
```

### Analytics Summary

```javascript
const summary = await claw.getLearningAnalyticsSummary({
  agent_id: 'my-agent'
});
// { maturity_level, velocity, total_episodes, success_rate, avg_score }
```
