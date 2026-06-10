export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { listModelStrategies } from '../../../lib/repositories/model-strategies.repository';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import { listCollections } from '../../../lib/repositories/knowledge.repository';
import { listCapabilities } from '../../../lib/repositories/capabilities.repository';
import { listTemplates } from '../../../lib/prompt';
import {
  getDefaultProviderModel,
  getProviderEntries,
  getProviderApiStyle,
  isSupportedProvider,
  isSupportedProviderModel,
} from '../../../lib/providers/providerRegistry';

const MAX_DESCRIPTION_LENGTH = 4000;

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripCodeFences(value: unknown): string {
  const cleaned = trimString(value);
  if (!cleaned.startsWith('```')) return cleaned;
  return cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
}

function parseWorkflowDraft(rawContent: unknown): any {
  const parsed = JSON.parse(stripCodeFences(rawContent));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model response was not a JSON object');
  }
  return parsed;
}

function resourceList(resources: any[], field: string): string {
  return resources
    .map((resource) => `- ${resource[field]}: ${resource.name}`)
    .join('\n');
}

function promptTemplateList(templates: any[]): string {
  return templates
    .map((template) => `- ${template.id}: ${template.name} (${template.category || 'general'})`)
    .join('\n');
}

function buildSystemPrompt(resources: any, preferExistingResources: boolean): string {
  const linkingInstruction = preferExistingResources
    ? 'Prefer linking to the existing resources listed below when they are relevant.'
    : 'You may suggest linked resources, but only when they materially help the workflow.';

  return `You generate draft DashClaw workflows.

DashClaw workflows currently run only these step types:
- knowledge_search
- capability_invoke
- prompt

Return a single JSON object with this shape:
{
  "name": "string",
  "description": "string",
  "objective": "string",
  "status": "draft",
  "linked_resources": {
    "model_strategy": "existing strategy id or name",
    "policies": ["existing policy id or name"],
    "knowledge_collections": ["existing collection id or name"],
    "capabilities": ["existing capability id or name"],
    "prompt_templates": ["existing prompt template id or name"],
    "capability_tags": ["string"]
  },
  "steps": [
    {
      "type": "knowledge_search",
      "name": "string",
      "collection": "existing collection id or name",
      "query": "string",
      "top_k": 5
    },
    {
      "type": "capability_invoke",
      "name": "string",
      "capability": "existing capability id or name",
      "body": { "field": "value" }
    },
    {
      "type": "prompt",
      "name": "string",
      "prompt_template": "plain text prompt body",
      "system_prompt": "optional string",
      "max_tokens": 1024,
      "temperature": 0.3
    }
  ],
  "notes": ["optional string"]
}

Rules:
- Return JSON only. No markdown.
- Keep the workflow sequential.
- Do not invent graph, branching, approval, or condition step types.
- If a resource is not clearly applicable, omit it instead of inventing an ID.
- ${linkingInstruction}

Existing model strategies:
${resourceList(resources.modelStrategies, 'strategy_id') || '- none'}

Existing policies:
${resourceList(resources.policies, 'id') || '- none'}

Existing knowledge collections:
${resourceList(resources.knowledgeCollections, 'collection_id') || '- none'}

Existing capabilities:
${resourceList(resources.capabilities, 'capability_id') || '- none'}

Existing prompt templates:
${promptTemplateList(resources.promptTemplates) || '- none'}
`;
}

async function providerFetch(url: string, options: RequestInit) {
  return fetch(url, options);
}

async function executeDraftCompletion(provider: string, apiKey: string, model: string, systemPrompt: string, description: string): Promise<string> {
  const apiStyle = getProviderApiStyle(provider);

  if (apiStyle === 'openai_chat_completions') {
    const res = await providerFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: description },
        ],
        max_tokens: 1800,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '{}';
  }

  if (apiStyle === 'anthropic_messages') {
    const res = await providerFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1800,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: description }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.content?.find((block: any) => block.type === 'text')?.text || '{}';
  }

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : provider === 'together'
      ? 'https://api.together.xyz/v1/chat/completions'
      : provider === 'perplexity'
        ? 'https://api.perplexity.ai/chat/completions'
        : null;

  if (!endpoint) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const res = await providerFetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ],
      max_tokens: 1800,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${provider} ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const description = trimString(body.description);
    const apiKey = trimString(body.api_key);
    const provider = trimString(body.provider) || 'openai';
    const model = trimString(body.model)
      || getDefaultProviderModel(provider, 'workflow_drafting' as unknown as null)
      || getDefaultProviderModel('openai', 'workflow_drafting' as unknown as null);
    const preferExistingResources = body.prefer_existing_resources !== false;

    if (!description) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json({ error: `description exceeds ${MAX_DESCRIPTION_LENGTH} characters` }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'api_key is required' }, { status: 400 });
    }
    if (!isSupportedProvider(provider) || !getProviderEntries().some((entry) => entry.id === provider && entry.defaults.workflow_drafting)) {
      return NextResponse.json({ error: 'provider is not supported for workflow draft generation' }, { status: 400 });
    }
    if (!isSupportedProviderModel(provider, model)) {
      return NextResponse.json({ error: 'model is not supported for the selected provider' }, { status: 400 });
    }

    const [
      modelStrategies,
      policies,
      knowledgeCollections,
      capabilities,
      promptTemplates,
    ] = await Promise.all([
      listModelStrategies(sql, orgId),
      getActivePolicies(sql, orgId),
      listCollections(sql, orgId, { limit: 50, offset: 0 }),
      listCapabilities(sql, orgId, { limit: 50, offset: 0 }),
      listTemplates(request),
    ]);

    const systemPrompt = buildSystemPrompt({
      modelStrategies,
      policies,
      knowledgeCollections,
      capabilities,
      promptTemplates,
    }, preferExistingResources);

    const rawContent = await executeDraftCompletion(provider, apiKey, model, systemPrompt, description);
    const draft = parseWorkflowDraft(rawContent);

    return NextResponse.json({
      draft,
      warnings: draft.notes || [],
      llm_metadata: {
        provider,
        model,
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Model response was not valid JSON' }, { status: 422 });
    }
    return apiErrorResponse(error, 'WORKFLOW DRAFT POST');
  }
}
