import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeLegacy = searchParams.get('legacy') === 'true';

    const readmePath = resolve(process.cwd(), 'sdk', 'README.md');
    let content = readFileSync(readmePath, 'utf8');

    if (includeLegacy) {
      const legacyPath = resolve(process.cwd(), 'sdk', 'legacy', 'dashclaw-v1.js');
      const legacyContent = readFileSync(legacyPath, 'utf8');
      content += '\n\n---\n\n## Legacy SDK (v1) Full Source — DEPRECATED\n\nThe complete v1 SDK source (deprecated legacy surface; do not build new work against it):\n\n```javascript\n' + legacyContent + '\n```\n';
    }

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
