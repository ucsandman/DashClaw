export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import {
  resolveAgentIdentifiers,
  getSharedActions,
  getAgentLinkMessages,
} from '../../../lib/repositories/swarm.repository';

/**
 * GET /api/swarm/link?source=ID&target=ID
 * Returns shared activity and messages between two agents.
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const target = searchParams.get('target');

    if (!source || !target) {
      return NextResponse.json({ error: 'source and target agent IDs are required' }, { status: 400 });
    }

    // Resolve any name/id aliases for each agent
    const agentMappings = await resolveAgentIdentifiers(sql, orgId, source, target);

    const sourceIds = new Set([source]);
    const targetIds = new Set([target]);

    for (const mapping of agentMappings) {
      if (mapping.agent_id === source || mapping.agent_name === source) {
        sourceIds.add(mapping.agent_id as string);
        if (mapping.agent_name) sourceIds.add(mapping.agent_name as string);
      }
      if (mapping.agent_id === target || mapping.agent_name === target) {
        targetIds.add(mapping.agent_id as string);
        if (mapping.agent_name) targetIds.add(mapping.agent_name as string);
      }
    }

    const [sharedActions, messages] = await Promise.all([
      getSharedActions(sql, orgId, sourceIds, targetIds),
      getAgentLinkMessages(sql, orgId, sourceIds, targetIds),
    ]);

    return NextResponse.json({
      source,
      target,
      shared_actions: sharedActions || [],
      messages: messages || [],
    });
  } catch (error) {
    console.error('[SWARM] Link API error:', error);
    return NextResponse.json({ error: 'Failed to fetch link context' }, { status: 500 });
  }
}
