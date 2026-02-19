export async function listPromptRuns(sql, orgId, filters = {}) {
  const { templateId, versionId, limit = 50 } = filters;
  
  if (templateId) {
    return sql`
      SELECT pr.*, pt.name AS template_name, pv.version
      FROM prompt_runs pr
      JOIN prompt_templates pt ON pt.id = pr.template_id
      JOIN prompt_versions pv ON pv.id = pr.version_id
      WHERE pr.org_id = ${orgId} AND pr.template_id = ${templateId}
      ORDER BY pr.created_at DESC
      LIMIT ${limit}
    `;
  }
  
  if (versionId) {
    return sql`
      SELECT pr.*, pt.name AS template_name, pv.version
      FROM prompt_runs pr
      JOIN prompt_templates pt ON pt.id = pr.template_id
      JOIN prompt_versions pv ON pv.id = pr.version_id
      WHERE pr.org_id = ${orgId} AND pr.version_id = ${versionId}
      ORDER BY pr.created_at DESC
      LIMIT ${limit}
    `;
  }
  
  return sql`
    SELECT pr.*, pt.name AS template_name, pv.version
    FROM prompt_runs pr
    JOIN prompt_templates pt ON pt.id = pr.template_id
    JOIN prompt_versions pv ON pv.id = pr.version_id
    WHERE pr.org_id = ${orgId}
    ORDER BY pr.created_at DESC
    LIMIT ${limit}
  `;
}
