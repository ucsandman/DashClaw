import crypto from 'crypto';
import { getSql } from './db';
import { getOrgId } from './org';

type PromptRow = Record<string, unknown>;

// -----------------------------------------------
// Prompt Template CRUD
// -----------------------------------------------

export async function listTemplates(request: Request, { category }: { category?: string } = {}): Promise<PromptRow[]> {
  const sql = getSql();
  const orgId = getOrgId(request);

  if (category) {
    return sql`
      SELECT t.*,
        (SELECT COUNT(*) FROM prompt_versions WHERE template_id = t.id) AS version_count,
        (SELECT pv.version FROM prompt_versions pv WHERE pv.template_id = t.id AND pv.is_active = TRUE LIMIT 1) AS active_version
      FROM prompt_templates t
      WHERE t.org_id = ${orgId} AND t.category = ${category}
      ORDER BY t.updated_at DESC
    `;
  }

  return sql`
    SELECT t.*,
      (SELECT COUNT(*) FROM prompt_versions WHERE template_id = t.id) AS version_count,
      (SELECT pv.version FROM prompt_versions pv WHERE pv.template_id = t.id AND pv.is_active = TRUE LIMIT 1) AS active_version
    FROM prompt_templates t
    WHERE t.org_id = ${orgId}
    ORDER BY t.updated_at DESC
  `;
}

export async function getTemplate(request: Request, templateId: string): Promise<PromptRow | null> {
  const sql = getSql();
  const orgId = getOrgId(request);
  const rows = await sql`
    SELECT * FROM prompt_templates WHERE id = ${templateId} AND org_id = ${orgId} LIMIT 1
  `;
  return rows[0] || null;
}

export async function createTemplate(
  request: Request,
  { name, description, category }: { name: string; description?: string; category?: string }
) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'pt_' + crypto.randomBytes(12).toString('hex');

  await sql`
    INSERT INTO prompt_templates (id, org_id, name, description, category)
    VALUES (${id}, ${orgId}, ${name}, ${description || ''}, ${category || 'general'})
  `;

  return { id, name, description, category };
}

export async function updateTemplate(
  request: Request,
  templateId: string,
  { name, description, category }: { name?: string; description?: string; category?: string }
): Promise<PromptRow | null> {
  const sql = getSql();
  const orgId = getOrgId(request);
  const fields: Record<string, unknown> = {};
  if (name !== undefined) fields.name = name;
  if (description !== undefined) fields.description = description;
  if (category !== undefined) fields.category = category;

  // Build dynamic update
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(k);
    vals.push(v);
  }
  if (sets.length === 0) return null;

  // Use tagged template for safety
  if (sets.includes('name') && sets.includes('description') && sets.includes('category')) {
    await sql`
      UPDATE prompt_templates SET name = ${fields.name}, description = ${fields.description}, category = ${fields.category}, updated_at = NOW()
      WHERE id = ${templateId} AND org_id = ${orgId}
    `;
  } else if (sets.includes('name')) {
    await sql`UPDATE prompt_templates SET name = ${fields.name}, updated_at = NOW() WHERE id = ${templateId} AND org_id = ${orgId}`;
  } else if (sets.includes('description')) {
    await sql`UPDATE prompt_templates SET description = ${fields.description}, updated_at = NOW() WHERE id = ${templateId} AND org_id = ${orgId}`;
  } else if (sets.includes('category')) {
    await sql`UPDATE prompt_templates SET category = ${fields.category}, updated_at = NOW() WHERE id = ${templateId} AND org_id = ${orgId}`;
  }

  return getTemplate(request, templateId);
}

export async function deleteTemplate(request: Request, templateId: string) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM prompt_templates WHERE id = ${templateId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Prompt Version CRUD
// -----------------------------------------------

export async function listVersions(request: Request, templateId: string): Promise<PromptRow[]> {
  const sql = getSql();
  const orgId = getOrgId(request);
  return sql`
    SELECT * FROM prompt_versions
    WHERE template_id = ${templateId} AND org_id = ${orgId}
    ORDER BY version DESC
  `;
}

export async function getVersion(request: Request, versionId: string): Promise<PromptRow | null> {
  const sql = getSql();
  const orgId = getOrgId(request);
  const rows = await sql`
    SELECT * FROM prompt_versions WHERE id = ${versionId} AND org_id = ${orgId} LIMIT 1
  `;
  return rows[0] || null;
}

export async function getActiveVersion(request: Request, templateId: string): Promise<PromptRow | null> {
  const sql = getSql();
  const orgId = getOrgId(request);
  const rows = await sql`
    SELECT * FROM prompt_versions
    WHERE template_id = ${templateId} AND org_id = ${orgId} AND is_active = TRUE
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function createVersion(
  request: Request,
  templateId: string,
  {
    content,
    model_hint,
    parameters,
    changelog,
  }: { content: string; model_hint?: string; parameters?: unknown; changelog?: string }
) {
  const sql = getSql();
  const orgId = getOrgId(request);

  // SECURITY: Verify template belongs to this org before writing
  const ownerCheck = await sql`
    SELECT id FROM prompt_templates WHERE id = ${templateId} AND org_id = ${orgId} LIMIT 1
  `;
  if (ownerCheck.length === 0) {
    return null; // caller treats null as 404
  }

  const id = 'pv_' + crypto.randomBytes(12).toString('hex');

  // Get next version number
  const maxRows = await sql`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM prompt_versions WHERE template_id = ${templateId} AND org_id = ${orgId}
  `;
  const nextVersion = ((maxRows[0]?.max_version as number) || 0) + 1;

  await sql`
    INSERT INTO prompt_versions (id, org_id, template_id, version, content, model_hint, parameters, changelog, created_by)
    VALUES (${id}, ${orgId}, ${templateId}, ${nextVersion}, ${content}, ${model_hint || ''}, ${JSON.stringify(parameters || [])}, ${changelog || ''}, 'user')
  `;

  // Update template updated_at
  await sql`UPDATE prompt_templates SET updated_at = NOW() WHERE id = ${templateId} AND org_id = ${orgId}`;

  return { id, template_id: templateId, version: nextVersion, content, is_active: false };
}

export async function activateVersion(request: Request, versionId: string) {
  const sql = getSql();
  const orgId = getOrgId(request);

  // Get template_id from version
  const version = await getVersion(request, versionId);
  if (!version) return null;

  // Deactivate all versions for this template
  await sql`
    UPDATE prompt_versions SET is_active = FALSE
    WHERE template_id = ${version.template_id} AND org_id = ${orgId}
  `;

  // Activate specified version
  await sql`UPDATE prompt_versions SET is_active = TRUE WHERE id = ${versionId} AND org_id = ${orgId}`;

  return { ...version, is_active: true };
}

// -----------------------------------------------
// Prompt Rendering
// -----------------------------------------------

export function renderPrompt(content: string, variables: Record<string, unknown> = {}): string {
  // Simple Mustache-style {{variable}} replacement.
  // `key` is escaped before interpolation so a variable name containing
  // regex metacharacters (e.g. `(a+)+b`) cannot inject pathological
  // backtracking patterns or rewrite the surrounding `\{\{ … \}\}` anchor.
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g');
    rendered = rendered.replace(regex, String(value));
  }
  return rendered;
}

export function extractParameters(content: string): string[] {
  // Extract {{variable}} patterns from prompt content
  const matches = content.match(/\{\{\s*(\w+)\s*\}\}/g) || [];
  const params = [...new Set(matches.map((m) => m.replace(/[{}]/g, '').trim()))];
  return params;
}

// -----------------------------------------------
// Prompt Runs (Usage Tracking)
// -----------------------------------------------

export async function recordPromptRun(
  request: Request,
  {
    template_id,
    version_id,
    action_id,
    agent_id,
    input_vars,
    rendered,
    tokens_used,
    latency_ms,
    outcome,
  }: {
    template_id: string;
    version_id: string;
    action_id?: string;
    agent_id?: string;
    input_vars?: Record<string, unknown>;
    rendered?: string;
    tokens_used?: number;
    latency_ms?: number;
    outcome?: string;
  }
) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'pr_' + crypto.randomBytes(12).toString('hex');
  const isMissingTable = (err: unknown) =>
    String((err as { code?: unknown })?.code || '').includes('42P01') ||
    String((err as { message?: unknown })?.message || '').includes('does not exist');

  try {
    await sql`
      INSERT INTO prompt_runs (id, org_id, template_id, version_id, action_id, agent_id, input_vars, rendered, tokens_used, latency_ms, outcome)
      VALUES (${id}, ${orgId}, ${template_id}, ${version_id}, ${action_id || ''}, ${agent_id || ''}, ${JSON.stringify(input_vars || {})}, ${rendered || ''}, ${tokens_used || 0}, ${latency_ms || 0}, ${outcome || ''})
    `;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return {
      id: null,
      recorded: false,
      missing_table: 'prompt_runs',
      setup_hint: 'Run scripts/migrate-prompts.mjs to enable prompt usage analytics.',
    };
  }

  return { id, recorded: true };
}

export async function getPromptStats(request: Request, { template_id }: { template_id?: string } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const isMissingTable = (err: unknown) =>
    String((err as { code?: unknown })?.code || '').includes('42P01') ||
    String((err as { message?: unknown })?.message || '').includes('does not exist');

  try {
    if (template_id) {
      const rows = await sql`
        SELECT
          COUNT(*) AS total_runs,
          ROUND(AVG(tokens_used), 0) AS avg_tokens,
          ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
          COUNT(DISTINCT version_id) AS versions_used,
          COUNT(DISTINCT agent_id) FILTER (WHERE agent_id != '') AS unique_agents
        FROM prompt_runs
        WHERE org_id = ${orgId} AND template_id = ${template_id}
      `;
      return rows[0] || {};
    }

    const overall = await sql`
      SELECT
        COUNT(*) AS total_runs,
        COUNT(DISTINCT template_id) AS unique_templates,
        ROUND(AVG(tokens_used), 0) AS avg_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today_count
      FROM prompt_runs
      WHERE org_id = ${orgId}
    `;

    const byTemplate = await sql`
      SELECT
        pt.name AS template_name,
        COUNT(pr.id) AS total_runs,
        ROUND(AVG(pr.tokens_used), 0) AS avg_tokens,
        ROUND(AVG(pr.latency_ms), 0) AS avg_latency_ms
      FROM prompt_runs pr
      JOIN prompt_templates pt ON pt.id = pr.template_id
      WHERE pr.org_id = ${orgId}
      GROUP BY pt.name
      ORDER BY total_runs DESC
      LIMIT 10
    `;

    const byVersion = await sql`
      SELECT
        pt.name AS template_name,
        pv.version,
        pv.id AS version_id,
        COUNT(pr.id) AS total_runs,
        ROUND(AVG(pr.tokens_used), 0) AS avg_tokens
      FROM prompt_runs pr
      JOIN prompt_versions pv ON pv.id = pr.version_id
      JOIN prompt_templates pt ON pt.id = pr.template_id
      WHERE pr.org_id = ${orgId}
      GROUP BY pt.name, pv.version, pv.id
      ORDER BY total_runs DESC
      LIMIT 20
    `;

    return {
      overall: overall[0] || {},
      by_template: byTemplate,
      by_version: byVersion,
      available: true,
    };
  } catch (error) {
    if (!isMissingTable(error)) throw error;

    return {
      overall: {
        total_runs: 0,
        unique_templates: 0,
        avg_tokens: null,
        avg_latency_ms: null,
        today_count: 0,
      },
      by_template: [],
      by_version: [],
      available: false,
      missing_table: 'prompt_runs',
      setup_hint: 'Run scripts/migrate-prompts.mjs to enable prompt usage analytics.',
    };
  }
}
