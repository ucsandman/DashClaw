import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const readmePath = resolve(process.cwd(), 'sdk', 'README.md');
    const content = readFileSync(readmePath, 'utf8');

    return new Response(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error reading SDK docs:', error);
    return NextResponse.json({ error: 'Documentation not found' }, { status: 404 });
  }
}
