import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

let _sql;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

export async function GET(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  try {
    // Get latest health snapshot
    const healthSnapshot = await sql`
      SELECT * FROM health_snapshots
      WHERE org_id = ${orgId}
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    // Get health history (last 7 snapshots)
    const healthHistory = await sql`
      SELECT timestamp, health_score, total_lines, potential_duplicates, stale_facts_count
      FROM health_snapshots
      WHERE org_id = ${orgId}
      ORDER BY timestamp DESC
      LIMIT 7
    `;

    // Get top entities
    const topEntities = await sql`
      SELECT name, type, mention_count
      FROM entities
      WHERE org_id = ${orgId}
      ORDER BY mention_count DESC
      LIMIT 20
    `;

    // Get topics
    const topics = await sql`
      SELECT name, mention_count
      FROM topics
      WHERE org_id = ${orgId}
      ORDER BY mention_count DESC
    `;

    // Get entity type breakdown
    const entityTypes = await sql`
      SELECT type, COUNT(*) as count, SUM(mention_count) as total_mentions
      FROM entities
      WHERE org_id = ${orgId}
      GROUP BY type
      ORDER BY total_mentions DESC
    `;

    const health = healthSnapshot[0] || null;

    return NextResponse.json({
      health: health ? {
        score: health.health_score,
        totalFiles: health.total_files,
        totalLines: health.total_lines,
        totalSizeKb: health.total_size_kb,
        memoryMdLines: health.memory_md_lines,
        oldestDaily: health.oldest_daily_file,
        newestDaily: health.newest_daily_file,
        daysWithNotes: health.days_with_notes,
        avgLinesPerDay: health.avg_lines_per_day,
        duplicates: health.potential_duplicates,
        staleCount: health.stale_facts_count,
        updatedAt: health.timestamp
      } : null,
      healthHistory: healthHistory.map(h => ({
        timestamp: h.timestamp,
        score: h.health_score,
        lines: h.total_lines,
        duplicates: h.potential_duplicates,
        stale: h.stale_facts_count
      })),
      entities: topEntities.map(e => ({
        name: e.name,
        type: e.type,
        mentions: e.mention_count
      })),
      topics: topics.map(t => ({
        name: t.name,
        mentions: t.mention_count
      })),
      entityBreakdown: entityTypes.map(e => ({
        type: e.type,
        count: e.count,
        totalMentions: e.total_mentions
      })),
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Memory API error:', error);
    return NextResponse.json({
      health: null,
      healthHistory: [],
      entities: [],
      topics: [],
      entityBreakdown: [],
      lastUpdated: new Date().toISOString(),
      error: 'An error occurred while fetching memory data'
    }, { status: 500 });
  }
}

export async function POST(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  try {
    const body = await request.json();
    const { health, entities, topics } = body;

    if (!health) {
      return NextResponse.json({ error: 'health object is required' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Upsert health snapshot
    const snapshot = await sql`
      INSERT INTO health_snapshots (
        org_id, timestamp, health_score, total_files, total_lines, total_size_kb,
        memory_md_lines, oldest_daily_file, newest_daily_file, days_with_notes,
        avg_lines_per_day, potential_duplicates, stale_facts_count
      ) VALUES (
        ${orgId}, ${now},
        ${health.score ?? health.health_score ?? 0},
        ${health.total_files ?? 0},
        ${health.total_lines ?? 0},
        ${health.total_size_kb ?? 0},
        ${health.memory_md_lines ?? 0},
        ${health.oldest_daily ?? null},
        ${health.newest_daily ?? null},
        ${health.days_with_notes ?? 0},
        ${health.avg_lines_per_day ?? 0},
        ${health.duplicates ?? health.potential_duplicates ?? 0},
        ${health.stale_count ?? health.stale_facts_count ?? 0}
      )
      RETURNING *
    `;

    // Upsert entities (replace all for this org)
    if (Array.isArray(entities) && entities.length > 0) {
      await sql`DELETE FROM entities WHERE org_id = ${orgId}`;
      for (const e of entities.slice(0, 100)) {
        await sql`
          INSERT INTO entities (org_id, name, type, mention_count)
          VALUES (${orgId}, ${e.name}, ${e.type || 'other'}, ${e.mentions ?? e.mention_count ?? 1})
        `;
      }
    }

    // Upsert topics (replace all for this org)
    if (Array.isArray(topics) && topics.length > 0) {
      await sql`DELETE FROM topics WHERE org_id = ${orgId}`;
      for (const t of topics.slice(0, 100)) {
        await sql`
          INSERT INTO topics (org_id, name, mention_count)
          VALUES (${orgId}, ${t.name}, ${t.mentions ?? t.mention_count ?? 1})
        `;
      }
    }

    return NextResponse.json({
      snapshot: snapshot[0],
      entities_count: entities?.length || 0,
      topics_count: topics?.length || 0
    }, { status: 201 });
  } catch (error) {
    console.error('Memory API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while reporting memory health' }, { status: 500 });
  }
}
