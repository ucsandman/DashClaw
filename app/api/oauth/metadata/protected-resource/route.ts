// app/api/oauth/metadata/protected-resource/route.js
import { NextResponse } from 'next/server';
import { issuerBase } from '../authorization-server/route';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const base = issuerBase(request);
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
  });
}
