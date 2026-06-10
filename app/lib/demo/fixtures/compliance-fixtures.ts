import { isoFromNow, DEMO_ORG, MS_DAY, MS_HOUR } from './shared-utils';

// ── Framework definitions with educational descriptions ──

interface FrameworkDef {
  id: string;
  name: string;
  description: string;
  version: string;
  controls_total: number;
  controls_covered: number;
  controls_partial: number;
  controls_gap: number;
  coverage_pct: number;
  last_assessed_days: number;
  created_days: number;
}

const frameworkDefs: FrameworkDef[] = [
  {
    id: 'fw_soc2',
    name: 'SOC 2 Type II',
    description:
      'SOC 2 evaluates controls relevant to security, availability, processing integrity, confidentiality, and privacy. DashClaw maps guard policies and action logging to SOC 2 trust service criteria, providing continuous evidence that agent operations meet the bar auditors expect.',
    version: '2024',
    controls_total: 12,
    controls_covered: 8,
    controls_partial: 3,
    controls_gap: 1,
    coverage_pct: 79,
    last_assessed_days: 3,
    created_days: 60,
  },
  {
    id: 'fw_iso27001',
    name: 'ISO 27001',
    description:
      'ISO 27001 is the international standard for information security management systems (ISMS). It defines Annex A controls spanning access management, cryptography, operations security, and supplier relationships. DashClaw maps org-level isolation and API key enforcement to relevant Annex A controls.',
    version: '2022',
    controls_total: 15,
    controls_covered: 9,
    controls_partial: 4,
    controls_gap: 2,
    coverage_pct: 73,
    last_assessed_days: 5,
    created_days: 90,
  },
  {
    id: 'fw_nist_ai',
    name: 'NIST AI RMF',
    description:
      'The NIST AI Risk Management Framework organizes AI risk practices into four functions: Govern, Map, Measure, and Manage. DashClaw covers Govern through guard policies and approval workflows, Measure through eval scorers, and Manage through security signals and block decisions.',
    version: '1.0',
    controls_total: 10,
    controls_covered: 4,
    controls_partial: 4,
    controls_gap: 2,
    coverage_pct: 60,
    last_assessed_days: 7,
    created_days: 45,
  },
  {
    id: 'fw_eu_ai',
    name: 'EU AI Act',
    description:
      'The EU AI Act is the first comprehensive AI regulation. It classifies AI systems by risk level (unacceptable, high, limited, minimal) and imposes transparency, human oversight, and documentation requirements. DashClaw supports human oversight via approval queues and transparency through action logging.',
    version: '2024',
    controls_total: 8,
    controls_covered: 3,
    controls_partial: 2,
    controls_gap: 3,
    coverage_pct: 50,
    last_assessed_days: 10,
    created_days: 30,
  },
  {
    id: 'fw_gdpr',
    name: 'GDPR',
    description:
      'The General Data Protection Regulation governs how personal data is collected, processed, and stored within the EU. It establishes data subject rights, lawful processing bases, and breach notification duties. DashClaw supports GDPR by logging all agent actions, enforcing access controls, and providing audit trails for data processing activities.',
    version: '2018',
    controls_total: 10,
    controls_covered: 5,
    controls_partial: 3,
    controls_gap: 2,
    coverage_pct: 70,
    last_assessed_days: 4,
    created_days: 120,
  },
];

// ── Control definitions per framework ──

interface ControlDef {
  control_id: string;
  name: string;
  description: string;
  status: string;
  policy_ids: string[];
  evidence_count: number;
  notes: string;
}

const controlDefs: Record<string, ControlDef[]> = {
  fw_soc2: [
    { control_id: 'CC6.1', name: 'Logical Access Controls', description: 'Controls who can access what. DashClaw enforces this through API key authentication and org-level isolation, ensuring each tenant\'s agents and data remain separated.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_002'], evidence_count: 42, notes: 'Demonstrated by x-api-key enforcement in middleware and org_id scoping on every query.' },
    { control_id: 'CC6.2', name: 'Access Authentication', description: 'Verifies identity before granting access. DashClaw uses x-api-key headers for agent/tool authentication and NextAuth with GitHub/Google OAuth for operator UI sessions.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 38, notes: 'Every API request is authenticated before reaching route handlers.' },
    { control_id: 'CC6.3', name: 'Access Authorization', description: 'Limits access to authorized resources only. DashClaw middleware strips client-supplied org headers and injects trusted values from the authenticated session, preventing privilege escalation.', status: 'covered', policy_ids: ['pol_demo_002'], evidence_count: 35, notes: 'Middleware rewrites x-org-id and x-user-id on every request.' },
    { control_id: 'CC6.6', name: 'System Boundary Protection', description: 'Restricts data flow at system boundaries. DashClaw rate limits enforce throughput caps and guard policies block unauthorized action types at the API boundary.', status: 'covered', policy_ids: ['pol_demo_003'], evidence_count: 29, notes: 'Rate limiter and guard decisions operate before action execution.' },
    { control_id: 'CC7.1', name: 'Security Monitoring', description: 'Detects anomalies and security events. DashClaw security signals flag patterns like high_impact_low_oversight and repeated_failures, surfacing them in the security dashboard.', status: 'covered', policy_ids: ['pol_demo_003', 'pol_demo_004'], evidence_count: 67, notes: 'Security signal engine runs on every guard decision.' },
    { control_id: 'CC7.2', name: 'Incident Response', description: 'Responds to identified incidents. Guard block decisions halt risky actions immediately, and approval queues route escalations to human operators for review.', status: 'partial', policy_ids: ['pol_demo_002'], evidence_count: 18, notes: 'Block and approval workflows exist; formal incident runbooks not yet defined.' },
    { control_id: 'CC7.3', name: 'Incident Recovery', description: 'Restores normal operations after incidents. DashClaw records full action context for post-incident review but does not yet automate rollback procedures.', status: 'partial', policy_ids: [], evidence_count: 8, notes: 'Action history supports investigation; automated recovery is a roadmap item.' },
    { control_id: 'CC8.1', name: 'Change Management', description: 'Controls changes to infrastructure and software. Guard policies require approval for deploy and security action types, ensuring human oversight before changes reach production.', status: 'covered', policy_ids: ['pol_demo_002'], evidence_count: 44, notes: 'Deploy actions route through approval queue by default policy.' },
    { control_id: 'CC9.1', name: 'Risk Mitigation', description: 'Identifies and mitigates risks. DashClaw guard policies block actions above risk thresholds and the eval scorer framework measures ongoing risk exposure.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_004'], evidence_count: 53, notes: 'Risk threshold policy and eval scorers provide quantitative risk mitigation.' },
    { control_id: 'CC9.2', name: 'Vendor Risk Management', description: 'Manages third-party risk. DashClaw tracks which agents and tools interact with external services but does not yet enforce vendor-specific policies.', status: 'partial', policy_ids: [], evidence_count: 5, notes: 'Agent metadata captures tool integrations; vendor risk policies are planned.' },
    { control_id: 'A1.1', name: 'Availability Commitments', description: 'Defines and measures availability targets. DashClaw records uptime of agent operations and surfaces health status in routing, but formal SLA definitions are not yet configured.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Health checks exist in routing; SLA threshold policies needed.' },
    { control_id: 'PI1.1', name: 'Processing Integrity', description: 'Ensures system processing is complete, accurate, and timely. DashClaw logs every action with timestamps, input/output payloads, and decision outcomes for auditability.', status: 'covered', policy_ids: ['pol_demo_004'], evidence_count: 71, notes: 'Full action lifecycle captured in decisions table.' },
  ],
  fw_iso27001: [
    { control_id: 'A.5.1', name: 'Information Security Policies', description: 'Establishes management direction for information security. DashClaw guard policies serve as executable security policies that are version-tracked and testable.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_002'], evidence_count: 40, notes: 'Guard policies are the security policy layer for agent operations.' },
    { control_id: 'A.5.2', name: 'Review of Policies', description: 'Ensures policies are reviewed at planned intervals. DashClaw policy test results track last-run timestamps and pass/fail status, supporting periodic review.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 15, notes: 'Policy test suite provides automated review evidence.' },
    { control_id: 'A.6.1', name: 'Organization of Information Security', description: 'Assigns information security responsibilities. DashClaw org roles (admin, operator, viewer) map responsibilities but role definitions could be more granular.', status: 'partial', policy_ids: ['pol_demo_002'], evidence_count: 12, notes: 'Org-level roles exist; fine-grained RBAC is a roadmap item.' },
    { control_id: 'A.8.1', name: 'Asset Inventory', description: 'Maintains an inventory of information assets. DashClaw agent registry tracks all registered agents and their capabilities, forming an AI asset inventory.', status: 'covered', policy_ids: [], evidence_count: 22, notes: 'Agent registry and capability declarations serve as the asset inventory.' },
    { control_id: 'A.8.2', name: 'Classification of Information', description: 'Classifies information according to sensitivity. DashClaw does not yet enforce data classification labels on action payloads.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Data classification tagging is planned for a future release.' },
    { control_id: 'A.9.1', name: 'Access Control Policy', description: 'Restricts access to information based on business requirements. DashClaw API key authentication and org-scoping enforce access boundaries.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_002'], evidence_count: 38, notes: 'Every API route enforces org-scoped access.' },
    { control_id: 'A.9.2', name: 'User Access Management', description: 'Manages user registration and de-registration. DashClaw supports GitHub and Google OAuth with session management through NextAuth.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 20, notes: 'OAuth providers handle identity lifecycle.' },
    { control_id: 'A.9.4', name: 'System Access Control', description: 'Prevents unauthorized access to systems and applications. DashClaw middleware enforces default-deny for all API routes not explicitly listed as public.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 45, notes: 'Middleware default-deny is tested and enforced in CI.' },
    { control_id: 'A.12.1', name: 'Operational Procedures', description: 'Documents operational procedures and responsibilities. DashClaw action logging creates an automated operations record for all agent activities.', status: 'covered', policy_ids: ['pol_demo_003'], evidence_count: 33, notes: 'Every agent action is logged with full context.' },
    { control_id: 'A.12.4', name: 'Logging and Monitoring', description: 'Records events and generates audit evidence. DashClaw records guard decisions, action outcomes, and security signals with timestamps and org context.', status: 'covered', policy_ids: ['pol_demo_003', 'pol_demo_004'], evidence_count: 78, notes: 'Guard decisions and security signals provide comprehensive audit trail.' },
    { control_id: 'A.12.6', name: 'Technical Vulnerability Management', description: 'Identifies and addresses technical vulnerabilities. DashClaw security signals detect patterns indicative of vulnerabilities but does not integrate with CVE databases.', status: 'partial', policy_ids: ['pol_demo_004'], evidence_count: 9, notes: 'Security signals detect anomalies; CVE integration not yet available.' },
    { control_id: 'A.14.1', name: 'Security in Development', description: 'Applies security requirements to the development lifecycle. DashClaw guard policies can gate deploy actions, but SDLC-specific security checks are not formalized.', status: 'partial', policy_ids: ['pol_demo_002'], evidence_count: 11, notes: 'Deploy gating exists; formal SDLC security policy recommended.' },
    { control_id: 'A.14.2', name: 'Secure Development Policy', description: 'Establishes rules for secure software development. DashClaw enforces code review via approval workflows but does not mandate specific secure coding standards.', status: 'partial', policy_ids: ['pol_demo_002'], evidence_count: 7, notes: 'Approval workflows support code review; coding standards not enforced.' },
    { control_id: 'A.16.1', name: 'Incident Management', description: 'Establishes incident management procedures. DashClaw block decisions and security signals create incident indicators but formal incident management processes need documentation.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Signals and blocks exist; incident management procedures not formalized.' },
    { control_id: 'A.18.1', name: 'Compliance with Legal Requirements', description: 'Ensures compliance with applicable legal and regulatory requirements. DashClaw compliance mapping provides framework-level tracking but legal review is external.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 14, notes: 'Compliance module maps controls to frameworks; legal review is an external process.' },
  ],
  fw_nist_ai: [
    { control_id: 'GOV-1', name: 'AI Governance Structure', description: 'Establishes organizational governance for AI systems. DashClaw provides a control plane with guard policies, approval workflows, and audit trails that form the governance backbone for AI agent operations.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_002'], evidence_count: 35, notes: 'Guard policies and approval queues implement AI governance.' },
    { control_id: 'GOV-2', name: 'Risk Tolerance Definition', description: 'Defines organizational risk appetite for AI. DashClaw risk threshold policies quantify acceptable risk levels and block actions that exceed them.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 28, notes: 'Risk threshold policy directly encodes risk tolerance.' },
    { control_id: 'GOV-3', name: 'AI Roles and Responsibilities', description: 'Assigns roles for AI oversight. DashClaw org roles separate operators, admins, and viewers, though AI-specific RACI matrices are not yet defined.', status: 'partial', policy_ids: ['pol_demo_002'], evidence_count: 10, notes: 'Org roles provide role separation; formal RACI for AI not defined.' },
    { control_id: 'MAP-1', name: 'Context and Use-Case Mapping', description: 'Documents the intended context and use cases for AI systems. DashClaw agent registration captures purpose and capabilities but lacks formal use-case documentation.', status: 'partial', policy_ids: [], evidence_count: 6, notes: 'Agent metadata captures capabilities; use-case docs are informal.' },
    { control_id: 'MAP-3', name: 'Benefits and Costs Analysis', description: 'Evaluates benefits, costs, and tradeoffs of AI systems. DashClaw cost analytics track agent operation costs but formal benefit-cost analysis is external.', status: 'partial', policy_ids: [], evidence_count: 4, notes: 'Cost analytics available; formal benefit-cost analysis not automated.' },
    { control_id: 'MEASURE-1', name: 'Performance Metrics', description: 'Defines and tracks AI performance metrics. DashClaw eval scorers measure action outcomes against defined criteria, providing quantitative performance data.', status: 'covered', policy_ids: ['pol_demo_003'], evidence_count: 42, notes: 'Eval scorers provide automated performance measurement.' },
    { control_id: 'MEASURE-2', name: 'Bias and Fairness Assessment', description: 'Evaluates AI systems for bias and fairness. DashClaw does not currently include bias detection capabilities; this requires integration with specialized fairness tooling.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Bias detection not implemented; fairness tooling integration needed.' },
    { control_id: 'MANAGE-1', name: 'Risk Response Planning', description: 'Plans responses to identified AI risks. DashClaw guard policies automatically respond to risks by blocking, requiring approval, or rate limiting agent actions.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_003'], evidence_count: 51, notes: 'Guard policies provide automated risk response.' },
    { control_id: 'MANAGE-3', name: 'Continuous Improvement', description: 'Establishes processes for ongoing AI improvement. DashClaw policy test results and eval scores track trends over time but automated improvement recommendations are not yet available.', status: 'partial', policy_ids: ['pol_demo_003'], evidence_count: 8, notes: 'Trend data available; automated improvement suggestions planned.' },
    { control_id: 'MANAGE-4', name: 'Decommission Procedures', description: 'Defines procedures for retiring AI systems. DashClaw agent lifecycle management does not yet include formal decommission workflows.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Agent decommission workflows not yet implemented.' },
  ],
  fw_eu_ai: [
    { control_id: 'ART-9', name: 'Risk Management System', description: 'Requires a risk management system for high-risk AI. DashClaw guard policies, risk thresholds, and security signals form a continuous risk management system for agent operations.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_004'], evidence_count: 48, notes: 'Guard policies and signals provide risk management.' },
    { control_id: 'ART-10', name: 'Data Governance', description: 'Mandates data governance for training and operational data. DashClaw logs action inputs/outputs but does not enforce data quality or representativeness standards.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Data governance policies for agent data not implemented.' },
    { control_id: 'ART-11', name: 'Technical Documentation', description: 'Requires comprehensive technical documentation of AI systems. DashClaw provides API docs and agent metadata but system-level technical documentation per EU AI Act Annex IV is not generated.', status: 'partial', policy_ids: [], evidence_count: 3, notes: 'API docs exist; Annex IV documentation format not implemented.' },
    { control_id: 'ART-13', name: 'Transparency Requirements', description: 'Mandates transparency for AI system users. DashClaw action logging and guard decision records provide transparency into what agents do and why decisions were made.', status: 'covered', policy_ids: ['pol_demo_002'], evidence_count: 56, notes: 'Full action and decision logging enables transparency.' },
    { control_id: 'ART-14', name: 'Human Oversight', description: 'Requires human oversight mechanisms for high-risk AI. DashClaw approval queues route critical actions to human operators, and the dashboard provides real-time visibility into agent activity.', status: 'covered', policy_ids: ['pol_demo_002', 'pol_demo_001'], evidence_count: 34, notes: 'Approval workflows and operator dashboard enable human oversight.' },
    { control_id: 'ART-15', name: 'Accuracy and Robustness', description: 'Requires appropriate levels of accuracy and robustness. DashClaw eval scorers measure accuracy-related metrics but does not enforce minimum accuracy thresholds.', status: 'partial', policy_ids: ['pol_demo_003'], evidence_count: 12, notes: 'Eval scorers measure outcomes; accuracy thresholds not enforced.' },
    { control_id: 'ART-17', name: 'Quality Management System', description: 'Requires a quality management system for high-risk AI providers. DashClaw does not yet implement a formal QMS covering the full AI lifecycle.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'QMS for AI lifecycle not yet implemented.' },
    { control_id: 'ART-52', name: 'General-Purpose AI Transparency', description: 'Requires transparency obligations for general-purpose AI models. DashClaw records all agent interactions and decisions, supporting downstream transparency requirements.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Interaction logging exists; GPAI-specific transparency reporting not built.' },
  ],
  fw_gdpr: [
    { control_id: 'ART-5', name: 'Principles of Processing', description: 'Establishes lawfulness, fairness, transparency, purpose limitation, data minimization, accuracy, storage limitation, and integrity principles. DashClaw enforces purpose limitation through guard policies that restrict action types.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_003'], evidence_count: 55, notes: 'Guard policies restrict processing to defined purposes.' },
    { control_id: 'ART-6', name: 'Lawfulness of Processing', description: 'Requires a legal basis for data processing. DashClaw does not manage consent or legal basis documentation; this requires integration with consent management systems.', status: 'partial', policy_ids: ['pol_demo_002'], evidence_count: 7, notes: 'Processing is logged; legal basis documentation is external.' },
    { control_id: 'ART-13', name: 'Information to Data Subjects', description: 'Requires providing processing information to data subjects. DashClaw does not generate data subject notices but logs all processing activities that feed into such notices.', status: 'partial', policy_ids: [], evidence_count: 4, notes: 'Processing logs available; data subject notice generation not built.' },
    { control_id: 'ART-25', name: 'Data Protection by Design', description: 'Mandates data protection by design and by default. DashClaw org-level isolation, API key authentication, and default-deny middleware implement data protection at the architecture level.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 30, notes: 'Architecture enforces data protection by design.' },
    { control_id: 'ART-30', name: 'Records of Processing Activities', description: 'Requires maintaining records of all processing activities. DashClaw action log captures every agent operation with timestamps, inputs, outputs, and decision context.', status: 'covered', policy_ids: ['pol_demo_003', 'pol_demo_004'], evidence_count: 89, notes: 'Action log serves as the processing activity record.' },
    { control_id: 'ART-32', name: 'Security of Processing', description: 'Requires appropriate security measures for processing. DashClaw implements encryption in transit, authentication, authorization, and rate limiting as security measures.', status: 'covered', policy_ids: ['pol_demo_001', 'pol_demo_002'], evidence_count: 41, notes: 'Multiple security layers protect processing operations.' },
    { control_id: 'ART-33', name: 'Breach Notification', description: 'Requires notification to supervisory authorities within 72 hours of a breach. DashClaw security signals detect potential breaches but does not automate notification workflows.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'Security signals detect anomalies; breach notification workflow not implemented.' },
    { control_id: 'ART-35', name: 'Data Protection Impact Assessment', description: 'Requires DPIA for high-risk processing. DashClaw risk scoring provides input to impact assessments but does not generate formal DPIA documents.', status: 'partial', policy_ids: ['pol_demo_001'], evidence_count: 9, notes: 'Risk scores inform DPIAs; formal DPIA templates not available.' },
    { control_id: 'ART-37', name: 'Data Protection Officer', description: 'Requires designation of a DPO in certain cases. DashClaw org roles do not include a DPO designation; this is an organizational responsibility.', status: 'gap', policy_ids: [], evidence_count: 0, notes: 'DPO designation is an organizational decision outside DashClaw scope.' },
    { control_id: 'ART-44', name: 'Cross-Border Transfer Safeguards', description: 'Restricts transfers of personal data outside the EU/EEA. DashClaw does not enforce data residency constraints on agent operations.', status: 'covered', policy_ids: ['pol_demo_001'], evidence_count: 15, notes: 'Org-scoped data isolation supports transfer controls when deployed regionally.' },
  ],
};

// ── Generate controls array from definitions ──

function generateControls(): Array<Record<string, unknown>> {
  const controls: Array<Record<string, unknown>> = [];
  for (const fw of frameworkDefs) {
    const fwControls = controlDefs[fw.id] || [];
    fwControls.forEach((c, i) => {
      controls.push({
        id: `ctrl_${fw.id}_${i + 1}`,
        org_id: DEMO_ORG,
        framework_id: fw.id,
        control_id: c.control_id,
        name: c.name,
        description: c.description,
        status: c.status,
        policy_ids: JSON.stringify(c.policy_ids),
        evidence_count: c.evidence_count,
        last_verified: isoFromNow((3 + i * 2) * MS_DAY),
        notes: c.notes,
      });
    });
  }
  return controls;
}

// ── Generate map and gaps objects from definitions ──

function generateMap(): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const fw of frameworkDefs) {
    const controls = controlDefs[fw.id] || [];
    map[fw.id] = {
      framework_id: fw.id,
      coverage: {
        total: fw.controls_total,
        covered: fw.controls_covered,
        partial: fw.controls_partial,
        gaps: fw.controls_gap,
      },
      controls: controls.map((c, i) => ({
        id: `ctrl_${fw.id}_${i + 1}`,
        control_id: c.control_id,
        title: c.name,
        description: c.description,
        status: c.status,
        matched_policies: c.policy_ids,
        evidence_count: c.evidence_count,
        recommendations: c.status === 'gap' ? ['Implement baseline policy for ' + c.name] : [],
      })),
    };
  }
  return map;
}

function generateGaps(): Record<string, unknown> {
  const gaps: Record<string, unknown> = {};
  for (const fw of frameworkDefs) {
    const fwControls = controlDefs[fw.id] || [];
    const fwGaps = fwControls.filter((c) => c.status === 'gap');
    const fwPartials = fwControls.filter((c) => c.status === 'partial');

    gaps[fw.id] = {
      framework_id: fw.id,
      risk_level: fw.coverage_pct > 80 ? 'low' : fw.coverage_pct > 60 ? 'medium' : 'high',
      narrative: `Continuous monitoring shows ${fw.coverage_pct}% coverage against ${fw.name} requirements.`,
      quick_wins: `Remediating ${fwGaps.length} critical gaps would increase coverage to ${Math.min(100, fw.coverage_pct + 15)}%.`,
      gaps: fwGaps.map((g) => ({
        control: g.control_id,
        title: g.name,
        description: g.description,
      })),
      remediations: fwGaps.concat(fwPartials).map((r) => ({
        action: `Review and enforce ${r.name} policy`,
        effort: pickEffort(r.control_id),
      })),
    };
  }
  return gaps;
}

function pickEffort(id: string): string {
  const charSum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const efforts = ['low', 'medium', 'high'];
  // Modulo keeps the index in-bounds for the non-empty `efforts` array;
  // cast away the noUncheckedIndexedAccess `| undefined`.
  return efforts[charSum % efforts.length] as string;
}

// ── Build frameworks array ──

const frameworks = frameworkDefs.map((fw) => ({
  id: fw.id,
  org_id: DEMO_ORG,
  name: fw.name,
  description: fw.description,
  version: fw.version,
  status: 'active',
  controls_total: fw.controls_total,
  controls_covered: fw.controls_covered,
  controls_partial: fw.controls_partial,
  controls_gap: fw.controls_gap,
  coverage_pct: fw.coverage_pct,
  last_assessed: isoFromNow(fw.last_assessed_days * MS_DAY),
  created_at: isoFromNow(fw.created_days * MS_DAY),
}));

// ── Evidence summary ──

const evidence = {
  total_guard_decisions: 847,
  total_blocked: 23,
  total_approval_requests: 56,
  total_actions_recorded: 12340,
  evidence_by_framework: {
    fw_soc2: { guard_decisions: 312, blocked: 9, approval_requests: 22, actions_logged: 4580 },
    fw_iso27001: { guard_decisions: 248, blocked: 7, approval_requests: 15, actions_logged: 3420 },
    fw_nist_ai: { guard_decisions: 134, blocked: 4, approval_requests: 10, actions_logged: 1890 },
    fw_eu_ai: { guard_decisions: 89, blocked: 2, approval_requests: 5, actions_logged: 1320 },
    fw_gdpr: { guard_decisions: 64, blocked: 1, approval_requests: 4, actions_logged: 1130 },
  },
};

// ── Policy test results: 14 passed, 1 failed ──

const policyTestResults = {
  total_policies: 6,
  total_tests: 15,
  passed: 14,
  failed: 1,
  last_run: isoFromNow(2 * MS_DAY),
  results: [
    { test_id: 'pt_1', policy_id: 'pol_demo_001', policy_name: 'High Risk Action Gate', test_input: JSON.stringify({ actionType: 'deploy', riskScore: 85 }), expected_decision: 'block', actual_decision: 'block', passed: true, timestamp: isoFromNow(2 * MS_HOUR) },
    { test_id: 'pt_2', policy_id: 'pol_demo_001', policy_name: 'High Risk Action Gate', test_input: JSON.stringify({ actionType: 'research', riskScore: 30 }), expected_decision: 'allow', actual_decision: 'allow', passed: true, timestamp: isoFromNow(2 * MS_HOUR) },
    { test_id: 'pt_3', policy_id: 'pol_demo_001', policy_name: 'High Risk Action Gate', test_input: JSON.stringify({ actionType: 'security', riskScore: 95 }), expected_decision: 'block', actual_decision: 'block', passed: true, timestamp: isoFromNow(2 * MS_HOUR) },
    { test_id: 'pt_4', policy_id: 'pol_demo_002', policy_name: 'Deploy Approval Required', test_input: JSON.stringify({ actionType: 'deploy', agentId: 'agent_01' }), expected_decision: 'require_approval', actual_decision: 'require_approval', passed: true, timestamp: isoFromNow(3 * MS_HOUR) },
    { test_id: 'pt_5', policy_id: 'pol_demo_002', policy_name: 'Deploy Approval Required', test_input: JSON.stringify({ actionType: 'research', agentId: 'agent_01' }), expected_decision: 'allow', actual_decision: 'allow', passed: true, timestamp: isoFromNow(3 * MS_HOUR) },
    { test_id: 'pt_6', policy_id: 'pol_demo_002', policy_name: 'Deploy Approval Required', test_input: JSON.stringify({ actionType: 'security', agentId: 'agent_02' }), expected_decision: 'require_approval', actual_decision: 'require_approval', passed: true, timestamp: isoFromNow(3 * MS_HOUR) },
    { test_id: 'pt_7', policy_id: 'pol_demo_003', policy_name: 'Rate Limit Noisy Agents', test_input: JSON.stringify({ agentId: 'agent_03', actionsInWindow: 31 }), expected_decision: 'warn', actual_decision: 'warn', passed: true, timestamp: isoFromNow(4 * MS_HOUR) },
    { test_id: 'pt_8', policy_id: 'pol_demo_003', policy_name: 'Rate Limit Noisy Agents', test_input: JSON.stringify({ agentId: 'agent_03', actionsInWindow: 50 }), expected_decision: 'block', actual_decision: 'block', passed: true, timestamp: isoFromNow(4 * MS_HOUR) },
    { test_id: 'pt_9', policy_id: 'pol_demo_003', policy_name: 'Rate Limit Noisy Agents', test_input: JSON.stringify({ agentId: 'agent_03', actionsInWindow: 10 }), expected_decision: 'allow', actual_decision: 'allow', passed: true, timestamp: isoFromNow(4 * MS_HOUR) },
    { test_id: 'pt_10', policy_id: 'pol_demo_004', policy_name: 'Block Delete Actions', test_input: JSON.stringify({ actionType: 'delete', target: 'user_data' }), expected_decision: 'block', actual_decision: 'block', passed: true, timestamp: isoFromNow(5 * MS_HOUR) },
    { test_id: 'pt_11', policy_id: 'pol_demo_004', policy_name: 'Block Delete Actions', test_input: JSON.stringify({ actionType: 'update', target: 'user_data' }), expected_decision: 'allow', actual_decision: 'allow', passed: true, timestamp: isoFromNow(5 * MS_HOUR) },
    { test_id: 'pt_12', policy_id: 'pol_demo_005', policy_name: 'Sensitive Data Access Log', test_input: JSON.stringify({ actionType: 'read', dataClass: 'pii', agentId: 'agent_04' }), expected_decision: 'allow_and_log', actual_decision: 'allow_and_log', passed: true, timestamp: isoFromNow(6 * MS_HOUR) },
    { test_id: 'pt_13', policy_id: 'pol_demo_005', policy_name: 'Sensitive Data Access Log', test_input: JSON.stringify({ actionType: 'read', dataClass: 'public', agentId: 'agent_04' }), expected_decision: 'allow', actual_decision: 'allow', passed: true, timestamp: isoFromNow(6 * MS_HOUR) },
    { test_id: 'pt_14', policy_id: 'pol_demo_006', policy_name: 'After-Hours Escalation', test_input: JSON.stringify({ actionType: 'deploy', hour: 23, riskScore: 40 }), expected_decision: 'require_approval', actual_decision: 'require_approval', passed: true, timestamp: isoFromNow(7 * MS_HOUR) },
    { test_id: 'pt_15', policy_id: 'pol_demo_006', policy_name: 'After-Hours Escalation', test_input: JSON.stringify({ actionType: 'deploy', hour: 23, riskScore: 70 }), expected_decision: 'block', actual_decision: 'require_approval', passed: false, timestamp: isoFromNow(7 * MS_HOUR) },
  ],
};

// ── Policy proof report (markdown) ──

const policyProofReport = `# Compliance Proof Report

**Organization:** ${DEMO_ORG}
**Generated:** ${isoFromNow(0)}
**Report Type:** Policy Enforcement Proof

---

## Frameworks Assessed

| Framework | Coverage | Controls | Covered | Partial | Gap |
|-----------|----------|----------|---------|---------|-----|
| SOC 2 Type II | 79% | 12 | 8 | 3 | 1 |
| ISO 27001 | 73% | 15 | 9 | 4 | 2 |
| NIST AI RMF | 60% | 10 | 4 | 4 | 2 |
| EU AI Act | 50% | 8 | 3 | 2 | 3 |
| GDPR | 70% | 10 | 5 | 3 | 2 |

## Enforcement Evidence

- **Guard Decisions Recorded:** 847
- **Actions Blocked:** 23
- **Approval Requests Generated:** 56
- **Total Actions Observed:** 12,340

## Policy Test Summary

- **Total Policies Tested:** 6
- **Total Test Cases:** 15
- **Passed:** 14
- **Failed:** 1

The failing test (pt_15) involves the After-Hours Escalation policy: high-risk deploys during off-hours should block but currently route to approval. Remediation is recommended.

## Recommendations

1. Investigate After-Hours Escalation policy threshold logic (test pt_15)
2. Add data classification policy to close ISO 27001 A.8.2 gap
3. Implement breach notification workflow for GDPR ART-33 compliance
4. Define SLA thresholds to address SOC 2 A1.1 availability gap
5. Integrate bias detection tooling for NIST AI RMF MEASURE-2

---
*Generated by DashClaw Policy Engine*`;

// ── Export ──

export const complianceData = {
  frameworks,
  controls: generateControls(),
  map: generateMap(),
  gaps: generateGaps(),
  evidence,
  policyTestResults,
  policyProofReport,
};
