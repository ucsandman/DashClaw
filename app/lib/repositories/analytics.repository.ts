/**
 * Analytics repository — all queries for the /analytics page.
 */

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

type Row = Record<string, unknown>;

export async function getAnalytics(sql: SqlClient, orgId: string, days = 30, agentId: string | null = null) {
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const prevStart = new Date(now.getTime() - days * 2 * 24 * 60 * 60 * 1000).toISOString();

  const safe = (promise: Promise<Row[]>): Promise<Row[]> => promise.catch(() => [{}]);
  // Optional global agent filter: `af(n)` appends the clause using positional
  // param $n; `wa(params)` appends the bound value. Applied to every
  // action_records AND guard_decisions query so all panels agree.
  const af = (n: number) => (agentId ? ` AND agent_id = $${n}` : '');
  const wa = (params: unknown[]) => (agentId ? [...params, agentId] : params);

  const [
    heroRows, prevHeroRows,
    dailyRows, dailyStatusRows,
    agentRows, typeRows,
    policyRows,
    tokenRows, tokenConsumerRows,
  ] = await Promise.all([
    // Current period hero stats
    safe(sql.query(
      `SELECT
        COALESCE(SUM(cost_estimate), 0)::real AS total_cost,
        COUNT(*)::int AS total_actions,
        COUNT(DISTINCT agent_id)::int AS active_agents,
        COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms > 0), 0)::int AS avg_latency_ms
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}`,
      wa([orgId, periodStart])
    )),

    // Previous period hero stats (for comparison)
    safe(sql.query(
      `SELECT
        COALESCE(SUM(cost_estimate), 0)::real AS total_cost,
        COUNT(*)::int AS total_actions,
        COUNT(DISTINCT agent_id)::int AS active_agents,
        COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms > 0), 0)::int AS avg_latency_ms
      FROM action_records
      WHERE org_id = $1
        AND timestamp_start::timestamptz >= $2::timestamptz
        AND timestamp_start::timestamptz < $3::timestamptz${af(4)}`,
      wa([orgId, prevStart, periodStart])
    )),

    // Daily cost trend — emit ISO date strings (YYYY-MM-DD) so the driver
    // doesn't hand back JS Date objects that stringify to the long toString form
    safe(sql.query(
      `SELECT TO_CHAR((timestamp_start::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COALESCE(SUM(cost_estimate), 0)::real AS cost,
        COUNT(*)::int AS actions
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}
      GROUP BY 1 ORDER BY 1`,
      wa([orgId, periodStart])
    )),

    // Daily status breakdown
    safe(sql.query(
      `SELECT TO_CHAR((timestamp_start::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','blocked'))::int AS other
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}
      GROUP BY 1 ORDER BY 1`,
      wa([orgId, periodStart])
    )),

    // Cost by agent (top 5)
    safe(sql.query(
      `SELECT agent_id, MAX(agent_name) AS agent_name,
        COALESCE(SUM(cost_estimate), 0)::real AS cost,
        COUNT(*)::int AS actions
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}
      GROUP BY agent_id ORDER BY cost DESC LIMIT 5`,
      wa([orgId, periodStart])
    )),

    // Cost by action type (top 5)
    safe(sql.query(
      `SELECT action_type,
        COALESCE(SUM(cost_estimate), 0)::real AS cost,
        COUNT(*)::int AS actions
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}
      GROUP BY action_type ORDER BY cost DESC LIMIT 5`,
      wa([orgId, periodStart])
    )),

    // Policy enforcement from guard_decisions
    safe(sql.query(
      `SELECT
        COUNT(*) FILTER (WHERE decision = 'block')::int AS blocked,
        COUNT(*) FILTER (WHERE decision = 'require_approval')::int AS require_approval,
        COUNT(*) FILTER (WHERE decision = 'warn')::int AS warn,
        COUNT(*)::int AS total
      FROM guard_decisions
      WHERE org_id = $1 AND created_at::timestamptz >= $2::timestamptz${af(3)}`,
      wa([orgId, periodStart])
    )),

    // Token totals
    safe(sql.query(
      `SELECT
        COALESCE(SUM(tokens_in), 0)::bigint AS total_in,
        COALESCE(SUM(tokens_out), 0)::bigint AS total_out,
        COALESCE(SUM(tokens_in) + SUM(tokens_out), 0)::bigint AS total,
        COALESCE(SUM(cost_estimate), 0)::real AS total_cost
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}
        AND (tokens_in > 0 OR tokens_out > 0)`,
      wa([orgId, periodStart])
    )),

    // Top token consumers (top 3)
    safe(sql.query(
      `SELECT agent_id, MAX(agent_name) AS agent_name,
        COALESCE(SUM(tokens_in) + SUM(tokens_out), 0)::bigint AS total_tokens,
        COALESCE(SUM(cost_estimate), 0)::real AS cost,
        COUNT(*)::int AS actions
      FROM action_records
      WHERE org_id = $1 AND timestamp_start::timestamptz >= $2::timestamptz${af(3)}
        AND (tokens_in > 0 OR tokens_out > 0)
      GROUP BY agent_id ORDER BY total_tokens DESC LIMIT 3`,
      wa([orgId, periodStart])
    )),
  ]);

  const hero = (heroRows[0] || {}) as Row;
  const prevHero = (prevHeroRows[0] || {}) as Row;
  const totalCost = parseFloat((hero.total_cost as string) || '0');
  const tokenTotal = parseInt((tokenRows[0]?.total as string) || '0', 10);
  const tokenTotalCost = parseFloat((tokenRows[0]?.total_cost as string) || '0');

  // Merge daily cost + daily status and gap-fill so the X-axis is continuous
  // (days with no records become zero-valued points rather than missing ticks)
  const costMap = new Map<string, Row>();
  for (const row of (dailyRows || [])) {
    if (row && row.date) costMap.set(String(row.date), row);
  }
  const statusMap = new Map<string, Row>();
  for (const row of (dailyStatusRows || [])) {
    if (row && row.date) statusMap.set(String(row.date), row);
  }

  const daily = [];
  const startUtc = new Date(periodStart);
  startUtc.setUTCHours(0, 0, 0, 0);
  const endUtc = new Date(now);
  endUtc.setUTCHours(0, 0, 0, 0);
  for (let d = new Date(startUtc); d <= endUtc; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const c = (costMap.get(iso) || {}) as Row;
    const s = (statusMap.get(iso) || {}) as Row;
    daily.push({
      date: iso,
      cost: Math.round(parseFloat((c.cost as string) || '0') * 1000) / 1000,
      actions: parseInt((c.actions as string) || '0', 10),
      completed: parseInt((s.completed as string) || '0', 10),
      failed: parseInt((s.failed as string) || '0', 10),
      blocked: parseInt((s.blocked as string) || '0', 10),
      other: parseInt((s.other as string) || '0', 10),
    });
  }

  // Calculate percentages for breakdowns
  const agentBreakdown = (agentRows || []).map(r => ({
    agent_id: r.agent_id,
    agent_name: r.agent_name || r.agent_id,
    cost: Math.round(parseFloat((r.cost as string) || '0') * 1000) / 1000,
    actions: parseInt((r.actions as string) || '0', 10),
    pct: totalCost > 0 ? Math.round((parseFloat((r.cost as string) || '0') / totalCost) * 1000) / 10 : 0,
  }));

  const typeBreakdown = (typeRows || []).map(r => ({
    action_type: r.action_type,
    cost: Math.round(parseFloat((r.cost as string) || '0') * 1000) / 1000,
    actions: parseInt((r.actions as string) || '0', 10),
    pct: totalCost > 0 ? Math.round((parseFloat((r.cost as string) || '0') / totalCost) * 1000) / 10 : 0,
  }));

  const policy = (policyRows[0] || {}) as Row;

  return {
    period: {
      start: periodStart.split('T')[0],
      end: now.toISOString().split('T')[0],
      days,
    },
    hero: {
      total_cost: Math.round(totalCost * 100) / 100,
      total_actions: parseInt((hero.total_actions as string) || '0', 10),
      active_agents: parseInt((hero.active_agents as string) || '0', 10),
      avg_latency_ms: parseInt((hero.avg_latency_ms as string) || '0', 10),
      prev_cost: Math.round(parseFloat((prevHero.total_cost as string) || '0') * 100) / 100,
      prev_actions: parseInt((prevHero.total_actions as string) || '0', 10),
      prev_agents: parseInt((prevHero.active_agents as string) || '0', 10),
      prev_latency_ms: parseInt((prevHero.avg_latency_ms as string) || '0', 10),
    },
    daily,
    by_agent: agentBreakdown,
    by_action_type: typeBreakdown,
    policy_enforcement: {
      blocked: parseInt((policy.blocked as string) || '0', 10),
      require_approval: parseInt((policy.require_approval as string) || '0', 10),
      warn: parseInt((policy.warn as string) || '0', 10),
      total: parseInt((policy.total as string) || '0', 10),
    },
    tokens: {
      total_in: parseInt((tokenRows[0]?.total_in as string) || '0', 10),
      total_out: parseInt((tokenRows[0]?.total_out as string) || '0', 10),
      total: tokenTotal,
      cost_per_million: tokenTotal > 0 ? Math.round((tokenTotalCost / tokenTotal) * 1_000_000 * 100) / 100 : 0,
      top_consumers: (tokenConsumerRows || []).map(r => ({
        agent_id: r.agent_id,
        agent_name: r.agent_name || r.agent_id,
        total_tokens: parseInt((r.total_tokens as string) || '0', 10),
        cost: Math.round(parseFloat((r.cost as string) || '0') * 1000) / 1000,
        actions: parseInt((r.actions as string) || '0', 10),
        avg_per_action: parseInt((r.actions as string) || '0', 10) > 0 ? Math.round(parseInt((r.total_tokens as string) || '0', 10) / parseInt((r.actions as string) || '0', 10)) : 0,
      })),
    },
  };
}
