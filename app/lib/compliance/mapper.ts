/**
 * Policy-to-control mapper
 * Maps agent guardrail policies to regulatory framework controls
 * Absorbed from AI-Agent-Governance-Compliance-Kit/packages/compliance-engine/src/mapper.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { globToRegex } from '../globToRegex';

const FRAMEWORKS_DIR = path.join(process.cwd(), 'app', 'lib', 'compliance', 'frameworks');

export interface PolicyMapping {
  policy_pattern: string;
  coverage: 'full' | 'partial' | string;
  rationale: string;
  tool_patterns?: string[];
}

export interface FrameworkControl {
  id: string;
  title: string;
  category: string;
  description: string;
  agent_relevance: string;
  policy_mappings: PolicyMapping[];
  gap_recommendations: string[];
}

export interface Framework {
  framework: string;
  version: string;
  controls: FrameworkControl[];
}

export interface PolicyRule {
  block?: boolean;
  require?: string;
  allowlist?: unknown;
  _dashclaw_type?: string;
  [key: string]: unknown;
}

export interface Policy {
  id: string;
  description: string;
  rule?: PolicyRule;
  applies_to?: { tools?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PolicyDoc {
  version?: string;
  project: string;
  policies: Policy[];
  [key: string]: unknown;
}

export interface MatchedPolicy {
  policy_id: string;
  policy_description: string;
  mapping_coverage: string;
  rationale: string;
}

export interface ControlMapping {
  control_id: string;
  title: string;
  category: string;
  description: string;
  agent_relevance: string;
  status: 'covered' | 'partial' | 'gap';
  matched_policies: MatchedPolicy[];
  gap_recommendations: string[];
}

export interface ComplianceMap {
  framework: string;
  framework_version: string;
  project: string;
  generated_at: string;
  summary: {
    total_controls: number;
    covered: number;
    partial: number;
    gaps: number;
    coverage_percentage: number;
  };
  controls: ControlMapping[];
}

/**
 * Load a regulatory framework definition
 * @param frameworkId - e.g., 'soc2', 'iso27001', 'gdpr'
 * @returns Framework definition
 */
export function loadFramework(frameworkId: string): Framework {
  const filePath = path.join(FRAMEWORKS_DIR, `${frameworkId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Framework not found: ${frameworkId}. Available: ${listFrameworks().join(', ')}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * List available frameworks
 */
export function listFrameworks(): string[] {
  if (!fs.existsSync(FRAMEWORKS_DIR)) return [];
  return fs.readdirSync(FRAMEWORKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * Map policies to framework controls
 * @param policyDoc - guardrailgen policy document (version, project, policies[])
 * @param framework - Framework definition from loadFramework()
 * @returns Compliance map
 */
export function mapPolicies(policyDoc: PolicyDoc, framework: Framework): ComplianceMap {
  const results: ComplianceMap = {
    framework: framework.framework,
    framework_version: framework.version,
    project: policyDoc.project,
    generated_at: new Date().toISOString(),
    summary: {
      total_controls: framework.controls.length,
      covered: 0,
      partial: 0,
      gaps: 0,
      coverage_percentage: 0,
    },
    controls: [],
  };

  for (const control of framework.controls) {
    const mapping = evaluateControl(control, policyDoc.policies);
    results.controls.push(mapping);

    if (mapping.status === 'covered') results.summary.covered++;
    else if (mapping.status === 'partial') results.summary.partial++;
    else results.summary.gaps++;
  }

  results.summary.coverage_percentage = Math.round(
    ((results.summary.covered + results.summary.partial * 0.5) / results.summary.total_controls) * 100
  );

  return results;
}

function evaluateControl(control: FrameworkControl, policies: Policy[]): ControlMapping {
  const matchedPolicies: MatchedPolicy[] = [];
  let bestCoverage = 'gap';

  for (const mapping of control.policy_mappings) {
    for (const policy of policies) {
      if (policyMatchesMapping(policy, mapping)) {
        matchedPolicies.push({
          policy_id: policy.id,
          policy_description: policy.description,
          mapping_coverage: mapping.coverage,
          rationale: mapping.rationale,
        });

        if (mapping.coverage === 'full' && bestCoverage !== 'full') {
          bestCoverage = 'covered';
        } else if (mapping.coverage === 'partial' && bestCoverage === 'gap') {
          bestCoverage = 'partial';
        }
      }
    }
  }

  let status: ControlMapping['status'];
  if (matchedPolicies.length === 0) {
    status = 'gap';
  } else if (bestCoverage === 'covered') {
    status = 'covered';
  } else {
    status = 'partial';
  }

  return {
    control_id: control.id,
    title: control.title,
    category: control.category,
    description: control.description,
    agent_relevance: control.agent_relevance,
    status,
    matched_policies: matchedPolicies,
    gap_recommendations: status !== 'covered' ? control.gap_recommendations : [],
  };
}

function policyMatchesMapping(policy: Policy, mapping: PolicyMapping): boolean {
  const patternMatch = checkPolicyPattern(policy, mapping.policy_pattern);
  if (!patternMatch) return false;

  if (mapping.tool_patterns && mapping.tool_patterns.length > 0) {
    const toolMatch = checkToolPatterns(policy, mapping.tool_patterns);
    if (!toolMatch) return false;
  }

  return true;
}

function checkPolicyPattern(policy: Policy, pattern: string): boolean {
  switch (pattern) {
    case 'block':
      return policy.rule?.block === true;
    case 'require_approval':
      return policy.rule?.require === 'approval';
    case 'allowlist':
      return Boolean(policy.rule?.allowlist && Array.isArray(policy.rule.allowlist));
    case 'rate_limit':
      return policy.rule?._dashclaw_type === 'rate_limit';
    case 'risk_threshold':
      return policy.rule?._dashclaw_type === 'risk_threshold';
    case 'dry_run':
      return policy.rule?._dashclaw_type === 'dry_run';
    case 'any_active_policy':
      return true;
    default:
      return false;
  }
}

function checkToolPatterns(policy: Policy, patterns: string[]): boolean {
  const policyTools = policy.applies_to?.tools || [];

  for (const pattern of patterns) {
    if (pattern === '*') return true;

    for (const tool of policyTools) {
      if (tool === pattern) return true;

      if (pattern.includes('*')) {
        if (globToRegex(pattern).test(tool)) return true;
      }
      if (tool.includes('*')) {
        if (globToRegex(tool).test(pattern)) return true;
      }
    }
  }

  return false;
}
