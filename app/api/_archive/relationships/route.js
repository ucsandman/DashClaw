export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';

// sql initialized inside handler for serverless compatibility

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    // Get all contacts (optionally filtered by agent)
    const rawContacts = agentId
      ? await sql`SELECT * FROM contacts WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY last_contact DESC NULLS LAST`
      : await sql`SELECT * FROM contacts WHERE org_id = ${orgId} ORDER BY last_contact DESC NULLS LAST`;

    // Get recent interactions with contact names (optionally filtered by agent)
    const rawInteractions = agentId
      ? await sql`
          SELECT i.*, c.name as contact_name
          FROM interactions i
          LEFT JOIN contacts c ON i.contact_id = c.id
          WHERE i.org_id = ${orgId} AND i.agent_id = ${agentId}
          ORDER BY i.date DESC LIMIT 50
        `
      : await sql`
          SELECT i.*, c.name as contact_name
          FROM interactions i
          LEFT JOIN contacts c ON i.contact_id = c.id
          WHERE i.org_id = ${orgId}
          ORDER BY i.date DESC LIMIT 50
        `;

    // Transform contacts to expected format (snake_case -> camelCase)
    const contacts = rawContacts.map(c => ({
      id: c.id,
      name: c.name,
      platform: c.platform || 'unknown',
      temperature: (c.temperature || 'warm').toUpperCase(),
      context: c.notes || c.opportunity_type || '',
      lastContact: c.last_contact,
      interactions: c.interaction_count || 0,
      followUpDate: c.next_followup
    }));

    // Transform interactions
    const interactions = rawInteractions.map(i => ({
      id: i.id,
      contactName: i.contact_name || 'Unknown',
      direction: i.direction || 'outbound',
      summary: i.summary || i.notes || '',
      type: i.type || 'message',
      platform: i.platform || 'unknown',
      date: i.date
    }));

    // Calculate stats
    const hot = contacts.filter(c => c.temperature === 'HOT').length;
    const warm = contacts.filter(c => c.temperature === 'WARM').length;
    const cold = contacts.filter(c => c.temperature === 'COLD').length;
    
    // Due follow-ups (including today and overdue)
    const today = new Date().toISOString().split('T')[0];
    const followUpsDue = contacts.filter(c => c.followUpDate && c.followUpDate <= today).length;

    const stats = {
      total: contacts.length,
      hot,
      warm,
      cold,
      followUpsDue
    };

    return NextResponse.json({
      contacts,
      interactions,
      stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Relationships API error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching relationship data', contacts: [], interactions: [], stats: {} }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { summary: 2000, contact_name: 500, direction: 50, type: 100, platform: 100 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { contact_name, contact_id, direction, summary, type, platform, agent_id } = body;

    if (!summary) {
      return NextResponse.json({ error: 'summary is required' }, { status: 400 });
    }

    // If contact_name provided but no contact_id, try to find or create contact
    let resolvedContactId = contact_id || null;
    if (contact_name && !contact_id) {
      const existing = await sql`
        SELECT id FROM contacts WHERE name = ${contact_name} AND org_id = ${orgId} LIMIT 1
      `;
      if (existing.length > 0) {
        resolvedContactId = existing[0].id;
      }
    }

    const result = await sql`
      INSERT INTO interactions (org_id, contact_id, direction, summary, type, platform, agent_id, date)
      VALUES (
        ${orgId},
        ${resolvedContactId},
        ${direction || 'outbound'},
        ${summary},
        ${type || 'message'},
        ${platform || null},
        ${agent_id || null},
        ${new Date().toISOString()}
      )
      RETURNING *
    `;

    // Update contact's last_contact and increment interaction_count
    if (resolvedContactId) {
      await sql`
        UPDATE contacts
        SET last_contact = ${new Date().toISOString()},
            interaction_count = COALESCE(interaction_count, 0) + 1
        WHERE id = ${resolvedContactId} AND org_id = ${orgId}
      `;
    }

    return NextResponse.json({ interaction: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Relationships API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while recording the interaction' }, { status: 500 });
  }
}

