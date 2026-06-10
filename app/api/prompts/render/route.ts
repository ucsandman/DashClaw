import { NextResponse } from 'next/server';
import { getActiveVersion, getVersion, renderPrompt, extractParameters, recordPromptRun } from '../../../lib/prompt';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { template_id, version_id, variables, action_id, agent_id, record } = body;

    if (!template_id && !version_id) {
      return NextResponse.json({ error: 'template_id or version_id is required' }, { status: 400 });
    }

    let version;
    if (version_id) {
      version = await getVersion(request, version_id);
    } else {
      version = await getActiveVersion(request, template_id);
    }

    if (!version) {
      return NextResponse.json({ error: 'No active version found for this template' }, { status: 404 });
    }

    const rendered = renderPrompt(version.content as string, variables || {});
    const params = extractParameters(version.content as string);

    const result: Record<string, unknown> = {
      rendered,
      version_id: version.id,
      template_id: version.template_id,
      version: version.version,
      parameters: params,
    };

    // Optionally record this render as a prompt run
    if (record) {
      const run = await recordPromptRun(request, {
        template_id: version.template_id as string,
        version_id: version.id as string,
        action_id,
        agent_id,
        input_vars: variables,
        rendered,
        tokens_used: body.tokens_used || 0,
        latency_ms: body.latency_ms || 0,
        outcome: body.outcome || '',
      });
      if (run?.id) result.run_id = run.id;
      if (run?.recorded === false) result.analytics = run;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[prompts/render] POST error:', err);
    return NextResponse.json({ error: 'Failed to render prompt' }, { status: 500 });
  }
}
