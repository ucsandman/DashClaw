/**
 * Build a structured audit payload from already-fetched session/message/tool
 * data. Pure — no DB, no fs. The route layer is responsible for loading
 * stored counters and (optionally) re-parsing the source JSONL to refresh
 * live_counts / live_deduped_totals.
 *
 * Ported from AgentLens (`src/audit.js`) — CommonJS → ESM, refactored from
 * `buildAudit(db, session)` to `buildAudit({ session, livedParse })`.
 *
 * Inputs:
 *   session — the stored row from `code_sessions`. Snake-case keys.
 *   livedParse (optional) — output of `parseSessionLines(...)` or
 *     `parseSessionFile(...)` over the source JSONL. When present we surface
 *     live counts + the top-10 requests with line provenance. When absent
 *     (e.g. the server cannot read the user's filesystem) we omit those
 *     fields and add a note.
 *
 * Output: see the returned object. Stable shape across call sites.
 */

import { PARSER_VERSION } from './parser';

interface AuditTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  cache_savings_usd?: number;
}

interface Audit {
  sessionId: unknown;
  sessionUuid: unknown;
  sourceFile: unknown;
  parserVersion: number;
  parserVersionExpected: number;
  counts: {
    jsonl_records: number;
    model_requests: number;
    message_count: number;
    duplicate_fragments_skipped: number;
  };
  deduped_totals: AuditTotals;
  naive_totals: Omit<AuditTotals, 'cache_savings_usd'>;
  needs_reingest: boolean;
  top_requests: Array<Record<string, unknown>>;
  notes: string[];
  live_counts?: Record<string, unknown>;
  live_deduped_totals?: Record<string, unknown>;
}

export function buildAudit({ session, livedParse = null }: { session: any; livedParse?: any }): Audit {
  const audit: Audit = {
    sessionId: session.id,
    sessionUuid: session.session_uuid,
    sourceFile: session.source_file,
    parserVersion: session.parser_version || 1,
    parserVersionExpected: PARSER_VERSION,
    counts: {
      jsonl_records: session.jsonl_records || 0,
      model_requests: session.model_requests || 0,
      message_count: session.message_count || 0,
      duplicate_fragments_skipped: session.duplicate_fragments_skipped || 0,
    },
    deduped_totals: {
      input_tokens: session.input_tokens || 0,
      output_tokens: session.output_tokens || 0,
      cache_read_tokens: session.cache_read_tokens || 0,
      cache_creation_tokens: session.cache_creation_tokens || 0,
      cost_usd: session.cost_usd || 0,
      cache_savings_usd: session.cache_savings_usd || 0,
    },
    naive_totals: {
      input_tokens: session.naive_input_tokens || 0,
      output_tokens: session.naive_output_tokens || 0,
      cache_read_tokens: session.naive_cache_read_tokens || 0,
      cache_creation_tokens: session.naive_cache_creation_tokens || 0,
      cost_usd: session.naive_cost_usd || 0,
    },
    needs_reingest: (session.parser_version || 1) < PARSER_VERSION,
    top_requests: [],
    notes: [],
  };

  if (livedParse && Array.isArray(livedParse.requests)) {
    const ranked = [...livedParse.requests].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 10);
    audit.top_requests = ranked.map(r => ({
      request_id: r.requestId,
      message_id: r.messageId,
      model: r.model,
      timestamp: r.timestamp,
      line_first: r.line_first,
      line_last: r.line_last,
      line_count: (r.lines && r.lines.length) || 0,
      fragment_types: r.fragment_types,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read_tokens: r.cache_read_tokens,
      cache_creation_tokens: r.cache_creation_tokens,
      cost_usd: r.cost_usd,
    }));
    audit.live_counts = {
      jsonl_records: livedParse.jsonlRecords,
      assistant_records: livedParse.assistantRecords,
      fragments_with_usage: livedParse.fragmentsWithUsage,
      model_requests: livedParse.modelRequests,
      duplicate_fragments_skipped: livedParse.duplicateFragmentsSkipped,
    };
    audit.live_deduped_totals = {
      input_tokens: livedParse.totals.input_tokens,
      output_tokens: livedParse.totals.output_tokens,
      cache_read_tokens: livedParse.totals.cache_read_tokens,
      cache_creation_tokens: livedParse.totals.cache_creation_tokens,
      cost_usd: livedParse.cost_usd,
      cache_savings_usd: livedParse.cache_savings_usd,
    };
    if (audit.needs_reingest) {
      audit.notes.push('Stored totals come from an older parser version; reingest the session to refresh.');
    }
  } else {
    audit.notes.push('Live re-parse unavailable; counts shown are stored totals only.');
  }

  return audit;
}
