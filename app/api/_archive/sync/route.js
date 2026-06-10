/**
 * Bulk Sync API — accepts all data categories in a single payload.
 * Each category is processed independently (try/catch island).
 * Uses the same SQL patterns as individual routes.
 */

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import crypto from 'crypto';
import { syncSchema } from '../../../lib/validators/sync';
import { scanSensitiveData } from '../../../lib/security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function genId(prefix) {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function redactText(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return scanSensitiveData(value).redacted;
}

// Category limits
const LIMITS = {
  connections: 1000,
  goals: 2000,
  learning: 2000,
  content: 2000,
  inspiration: 2000,
  context_points: 5000,
  context_threads: 1000,
  snippets: 1000,
  handoffs: 1000,
  observations: 1000,
  preferences: 1000,
  moods: 1000,
  approaches: 1000,
  relationships: 1000,
  capabilities: 1000,
};

// --- Category sync functions ---

async function syncConnections(sql, orgId, agentId, connections) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const conn of connections.slice(0, LIMITS.connections)) {
    try {
      const id = `conn_${crypto.randomUUID()}`;
      const authType = conn.auth_type || 'api_key';
      const status = conn.status || 'active';
      await sql`
        INSERT INTO agent_connections (id, org_id, agent_id, provider, auth_type, status, metadata, reported_at, updated_at)
        VALUES (${id}, ${orgId}, ${agentId}, ${conn.provider}, ${authType}, ${status}, ${conn.metadata || null}, ${now}, ${now})
        ON CONFLICT (org_id, agent_id, provider) DO UPDATE SET
          auth_type = EXCLUDED.auth_type,
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `;
      synced++;
    } catch (e) {
      errors.push(`connection ${conn.provider}: sync failed`);
    }
  }
  return { synced, errors };
}

async function syncMemory(sql, orgId, memory) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  try {
    if (memory.health) {
      const h = memory.health;
      await sql`
        INSERT INTO health_snapshots (
          org_id, timestamp, health_score, total_files, total_lines, total_size_kb,
          memory_md_lines, oldest_daily_file, newest_daily_file, days_with_notes,
          avg_lines_per_day, potential_duplicates, stale_facts_count
        ) VALUES (
          ${orgId}, ${now},
          ${h.score ?? h.health_score ?? 0},
          ${h.total_files ?? 0},
          ${h.total_lines ?? 0},
          ${h.total_size_kb ?? 0},
          ${h.memory_md_lines ?? 0},
          ${h.oldest_daily ?? null},
          ${h.newest_daily ?? null},
          ${h.days_with_notes ?? 0},
          ${h.avg_lines_per_day ?? 0},
          ${h.duplicates ?? h.potential_duplicates ?? 0},
          ${h.stale_count ?? h.stale_facts_count ?? 0}
        )
      `;
      synced++;
    }

    if (memory.entities?.length) {
      await sql`DELETE FROM entities WHERE org_id = ${orgId}`;
      for (const e of memory.entities.slice(0, 100)) {
        await sql`
          INSERT INTO entities (org_id, name, type, mention_count)
          VALUES (${orgId}, ${e.name}, ${e.type || 'other'}, ${e.mentions ?? e.mention_count ?? 1})
        `;
        synced++;
      }
    }

    if (memory.topics?.length) {
      await sql`DELETE FROM topics WHERE org_id = ${orgId}`;
      for (const t of memory.topics.slice(0, 100)) {
        await sql`
          INSERT INTO topics (org_id, name, mention_count)
          VALUES (${orgId}, ${t.name}, ${t.mentions ?? t.mention_count ?? 1})
        `;
        synced++;
      }
    }
  } catch (e) {
    errors.push(`memory: sync failed`);
  }

  return { synced, errors };
}

async function syncGoals(sql, orgId, agentId, goals) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const g of goals.slice(0, LIMITS.goals)) {
    try {
      await sql`
        INSERT INTO goals (org_id, title, category, description, target_date, progress, status, agent_id, created_at)
        VALUES (
          ${orgId}, ${redactText(g.title)}, ${g.category || null}, ${redactText(g.description || null)},
          ${g.target_date || null}, ${g.progress || 0}, ${g.status || 'active'},
          ${agentId}, ${now}
        )
      `;
      synced++;
    } catch (e) {
      errors.push(`goal "${g.title}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncLearning(sql, orgId, agentId, learning) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const l of learning.slice(0, LIMITS.learning)) {
    try {
      await sql`
        INSERT INTO decisions (org_id, decision, context, reasoning, outcome, confidence, timestamp, agent_id)
        VALUES (
          ${orgId}, ${redactText(l.decision)}, ${redactText(l.context || null)}, ${redactText(l.reasoning || null)},
          ${l.outcome || 'pending'}, ${l.confidence || 50}, ${now}, ${agentId}
        )
      `;
      synced++;
    } catch (e) {
      errors.push(`learning "${l.decision?.slice(0, 30)}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncContent(sql, orgId, agentId, content) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const c of content.slice(0, LIMITS.content)) {
    try {
      await sql`
        INSERT INTO content (org_id, title, platform, status, url, body, agent_id, created_at)
        VALUES (
          ${orgId}, ${redactText(c.title)}, ${c.platform || null}, ${c.status || 'draft'},
          ${c.url || null}, ${redactText(c.body || null)}, ${agentId}, ${now}
        )
      `;
      synced++;
    } catch (e) {
      errors.push(`content "${c.title}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncInspiration(sql, orgId, inspiration) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const i of inspiration.slice(0, LIMITS.inspiration)) {
    try {
      await sql`
        INSERT INTO ideas (org_id, title, description, category, score, status, source, captured_at)
        VALUES (
          ${orgId}, ${redactText(i.title)}, ${redactText(i.description || null)}, ${i.category || null},
          ${i.score || 50}, ${i.status || 'pending'}, ${i.source || null}, ${now}
        )
      `;
      synced++;
    } catch (e) {
      errors.push(`idea "${i.title}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncContextPoints(sql, orgId, agentId, points) {
  const now = new Date().toISOString();
  const dateStr = now.split('T')[0];
  let synced = 0;
  const errors = [];
  const validCategories = ['decision', 'task', 'insight', 'question', 'general'];

  for (const p of points.slice(0, LIMITS.context_points)) {
    try {
      const id = genId('cp_');
      const cat = validCategories.includes(p.category) ? p.category : 'general';
      const imp = Math.max(1, Math.min(10, p.importance || 5));
      await sql`
        INSERT INTO context_points (id, org_id, agent_id, content, category, importance, session_date, created_at)
        VALUES (${id}, ${orgId}, ${agentId}, ${redactText(p.content)}, ${cat}, ${imp}, ${p.session_date || dateStr}, ${now})
      `;
      synced++;
    } catch (e) {
      errors.push(`context point: sync failed`);
    }
  }
  return { synced, errors };
}

async function syncContextThreads(sql, orgId, agentId, threads) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const t of threads.slice(0, LIMITS.context_threads)) {
    try {
      const id = genId('ct_');
      await sql`
        INSERT INTO context_threads (id, org_id, agent_id, name, summary, status, created_at, updated_at)
        VALUES (${id}, ${orgId}, ${agentId}, ${redactText(t.name)}, ${redactText(t.summary || null)}, 'active', ${now}, ${now})
        ON CONFLICT (org_id, COALESCE(agent_id, ''), name)
        DO UPDATE SET summary = COALESCE(EXCLUDED.summary, context_threads.summary), status = 'active', updated_at = ${now}
      `;
      synced++;
    } catch (e) {
      errors.push(`thread "${t.name}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncHandoffs(sql, orgId, agentId, handoffs) {
  const now = new Date().toISOString();
  const dateStr = now.split('T')[0];
  let synced = 0;
  const errors = [];

  for (const h of handoffs.slice(0, LIMITS.handoffs)) {
    try {
      const id = genId('ho_');
      await sql`
        INSERT INTO handoffs (id, org_id, agent_id, session_date, summary, key_decisions, open_tasks, mood_notes, next_priorities, created_at)
        VALUES (
          ${id}, ${orgId}, ${agentId}, ${h.session_date || dateStr}, ${redactText(h.summary)},
          ${h.key_decisions ? JSON.stringify(h.key_decisions) : null},
          ${h.open_tasks ? JSON.stringify(h.open_tasks) : null},
          ${redactText(h.mood_notes || null)},
          ${h.next_priorities ? JSON.stringify(h.next_priorities) : null},
          ${now}
        )
      `;
      synced++;
    } catch (e) {
      errors.push(`handoff: sync failed`);
    }
  }
  return { synced, errors };
}

async function syncPreferences(sql, orgId, agentId, preferences) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  // Observations
  if (preferences.observations?.length) {
    for (const o of preferences.observations.slice(0, LIMITS.observations)) {
      try {
        const id = genId('uo_');
        await sql`
          INSERT INTO user_observations (id, org_id, user_id, agent_id, observation, category, importance, created_at)
          VALUES (${id}, ${orgId}, ${null}, ${agentId}, ${redactText(o.observation)}, ${o.category || null}, ${o.importance || 5}, ${now})
        `;
        synced++;
      } catch (e) {
        errors.push(`observation: sync failed`);
      }
    }
  }

  // Preferences
  if (preferences.preferences?.length) {
    for (const p of preferences.preferences.slice(0, LIMITS.preferences)) {
      try {
        const id = genId('up_');
        await sql`
          INSERT INTO user_preferences (id, org_id, user_id, agent_id, preference, category, confidence, created_at)
          VALUES (${id}, ${orgId}, ${null}, ${agentId}, ${redactText(p.preference)}, ${p.category || null}, ${p.confidence || 50}, ${now})
        `;
        synced++;
      } catch (e) {
        errors.push(`preference: sync failed`);
      }
    }
  }

  // Moods
  if (preferences.moods?.length) {
    for (const m of preferences.moods.slice(0, LIMITS.moods)) {
      try {
        const id = genId('um_');
        await sql`
          INSERT INTO user_moods (id, org_id, user_id, agent_id, mood, energy, notes, created_at)
          VALUES (${id}, ${orgId}, ${null}, ${agentId}, ${redactText(m.mood)}, ${m.energy || null}, ${redactText(m.notes || null)}, ${now})
        `;
        synced++;
      } catch (e) {
        errors.push(`mood: sync failed`);
      }
    }
  }

  // Approaches
  if (preferences.approaches?.length) {
    for (const a of preferences.approaches.slice(0, LIMITS.approaches)) {
      try {
        const id = genId('ua_');
        const successInc = a.success === true ? 1 : 0;
        const failInc = a.success === false ? 1 : 0;
        await sql`
          INSERT INTO user_approaches (id, org_id, user_id, agent_id, approach, context, success_count, fail_count, created_at, updated_at)
          VALUES (${id}, ${orgId}, ${null}, ${agentId}, ${redactText(a.approach)}, ${redactText(a.context || null)}, ${successInc}, ${failInc}, ${now}, ${now})
          ON CONFLICT (org_id, COALESCE(agent_id, ''), approach)
          DO UPDATE SET
            success_count = user_approaches.success_count + ${successInc},
            fail_count = user_approaches.fail_count + ${failInc},
            context = COALESCE(EXCLUDED.context, user_approaches.context),
            updated_at = ${now}
        `;
        synced++;
      } catch (e) {
        errors.push(`approach "${a.approach}": sync failed`);
      }
    }
  }

  return { synced, errors };
}

async function syncSnippets(sql, orgId, agentId, snippets) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const s of snippets.slice(0, LIMITS.snippets)) {
    try {
      const id = genId('sn_');
      const tagsJson = s.tags ? JSON.stringify(s.tags) : null;
      await sql`
        INSERT INTO snippets (id, org_id, agent_id, name, description, code, language, tags, created_at)
        VALUES (${id}, ${orgId}, ${agentId}, ${redactText(s.name)}, ${redactText(s.description || null)}, ${redactText(s.code)}, ${s.language || null}, ${tagsJson}, ${now})
        ON CONFLICT (org_id, name)
        DO UPDATE SET code = EXCLUDED.code, description = COALESCE(EXCLUDED.description, snippets.description),
          language = COALESCE(EXCLUDED.language, snippets.language), tags = COALESCE(EXCLUDED.tags, snippets.tags),
          agent_id = COALESCE(EXCLUDED.agent_id, snippets.agent_id)
      `;
      synced++;
    } catch (e) {
      errors.push(`snippet "${s.name}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncRelationships(sql, orgId, agentId, relationships) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const r of relationships.slice(0, LIMITS.relationships)) {
    try {
      const name = redactText(r.name);
      // Skip if contact already exists for this org+agent
      const existing = await sql`
        SELECT id FROM contacts WHERE org_id = ${orgId} AND agent_id = ${agentId} AND name = ${name} LIMIT 1
      `;
      if (existing.length > 0) { synced++; continue; }

      await sql`
        INSERT INTO contacts (org_id, agent_id, name, platform, notes, opportunity_type, created_at)
        VALUES (${orgId}, ${agentId}, ${name}, ${r.relationship_type || 'contact'}, ${redactText(r.description || null)}, ${r.relationship_type || null}, ${now})
      `;
      synced++;
    } catch (e) {
      errors.push(`relationship "${r.name}": sync failed`);
    }
  }
  return { synced, errors };
}

async function syncCapabilities(sql, orgId, agentId, capabilities) {
  const now = new Date().toISOString();
  let synced = 0;
  const errors = [];

  for (const c of capabilities.slice(0, LIMITS.capabilities)) {
    try {
      const id = genId('ac_');
      await sql`
        INSERT INTO agent_capabilities (id, org_id, agent_id, name, capability_type, description, source_path, file_count, metadata, created_at, updated_at)
        VALUES (${id}, ${orgId}, ${agentId}, ${redactText(c.name)}, ${c.capability_type || 'skill'}, ${redactText(c.description || null)}, ${c.source_path || null}, ${c.file_count || 1}, ${c.metadata ? JSON.stringify(c.metadata) : null}, ${now}, ${now})
        ON CONFLICT (org_id, COALESCE(agent_id, ''), name, capability_type) DO UPDATE SET
          description = COALESCE(EXCLUDED.description, agent_capabilities.description),
          source_path = COALESCE(EXCLUDED.source_path, agent_capabilities.source_path),
          file_count = EXCLUDED.file_count,
          metadata = COALESCE(EXCLUDED.metadata, agent_capabilities.metadata),
          updated_at = EXCLUDED.updated_at
      `;
      synced++;
    } catch (e) {
      errors.push(`capability "${c.name}": sync failed`);
    }
  }
  return { synced, errors };
}

// --- Main POST handler ---

export async function POST(request) {
  try {
    const callerOrgId = getOrgId(request);
    const callerRole = request.headers.get('x-org-role') || 'member';
    const bodyRaw = await request.json();

    // Validate payload
    const validation = syncSchema.safeParse(bodyRaw);
    if (!validation.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validation.error.format()
      }, { status: 400 });
    }
    const body = validation.data;

    // SECURITY: Always use the caller's own org. Cross-org writes are not
    // allowed — bootstrap scripts should authenticate with the target org's
    // own API key instead of relying on target_org_id overrides.
    const orgId = callerOrgId;
    const agentId = body.agent_id || null;
    const sql = getSql();
    const start = Date.now();

    const results = {};
    let totalSynced = 0;
    let totalErrors = 0;

    // Process each category independently
    const categories = [
      { key: 'connections', fn: () => syncConnections(sql, orgId, agentId, body.connections) },
      { key: 'memory', fn: () => syncMemory(sql, orgId, body.memory) },
      { key: 'goals', fn: () => syncGoals(sql, orgId, agentId, body.goals) },
      { key: 'learning', fn: () => syncLearning(sql, orgId, agentId, body.learning) },
      { key: 'content', fn: () => syncContent(sql, orgId, agentId, body.content) },
      { key: 'inspiration', fn: () => syncInspiration(sql, orgId, body.inspiration) },
      { key: 'context_points', fn: () => syncContextPoints(sql, orgId, agentId, body.context_points) },
      { key: 'context_threads', fn: () => syncContextThreads(sql, orgId, agentId, body.context_threads) },
      { key: 'handoffs', fn: () => syncHandoffs(sql, orgId, agentId, body.handoffs) },
      { key: 'preferences', fn: () => syncPreferences(sql, orgId, agentId, body.preferences) },
      { key: 'snippets', fn: () => syncSnippets(sql, orgId, agentId, body.snippets) },
      { key: 'relationships', fn: () => syncRelationships(sql, orgId, agentId, body.relationships) },
      { key: 'capabilities', fn: () => syncCapabilities(sql, orgId, agentId, body.capabilities) },
    ];

    for (const { key, fn } of categories) {
      if (!body[key]) continue;
      try {
        const result = await fn();
        results[key] = { synced: result.synced };
        if (result.errors.length) {
          results[key].errors = result.errors;
          totalErrors += result.errors.length;
        }
        totalSynced += result.synced;
      } catch (e) {
        results[key] = { synced: 0, errors: ['sync failed'] };
        totalErrors++;
      }
    }

    return NextResponse.json({
      results,
      total_synced: totalSynced,
      total_errors: totalErrors,
      duration_ms: Date.now() - start,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
