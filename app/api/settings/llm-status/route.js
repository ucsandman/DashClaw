export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org.js';
import { isLLMAvailable, getLLMProviderInfo } from '../../../../lib/llm.js';

/**
 * GET /api/settings/llm-status   Check if an AI provider is configured.
 * Returns { available, provider, model } so the UI can enable/disable LLM-dependent features.
 */
export async function GET(request) {
  try {
    getOrgId(request); // Auth check (middleware injects org headers)

    const available = isLLMAvailable();
    const info = getLLMProviderInfo();

    return NextResponse.json({
      available,
      provider: info?.name || null,
      model: info?.model || null,
    });
  } catch (error) {
    console.error('LLM status check error:', error);
    return NextResponse.json({ available: false, provider: null, model: null });
  }
}
