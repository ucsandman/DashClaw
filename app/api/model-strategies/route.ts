export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import {
  listModelStrategies,
  createModelStrategy,
} from '../../lib/repositories/model-strategies.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const strategies = await listModelStrategies(sql, orgId);
    return NextResponse.json({ strategies });
  } catch (error) {
    return apiErrorResponse(error, 'MODEL STRATEGIES GET');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body?.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!body?.config) {
      return NextResponse.json({ error: 'config is required' }, { status: 400 });
    }

    try {
      const strategy = await createModelStrategy(sql, orgId, body);
      return NextResponse.json({ strategy }, { status: 201 });
    } catch (validationError) {
      if ((validationError as Error).message?.startsWith('config')) {
        return NextResponse.json({ error: (validationError as Error).message }, { status: 400 });
      }
      throw validationError;
    }
  } catch (error) {
    return apiErrorResponse(error, 'MODEL STRATEGIES POST');
  }
}
