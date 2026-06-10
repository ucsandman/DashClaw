import { scanSensitiveData } from './security';

/**
 * Embedding utility for Behavioral AI Guardrails.
 * Converts agent actions into vector representations for anomaly detection.
 *
 * The `openai` package is loaded lazily via dynamic import so that the core
 * governance runtime (`/api/guard`, `/api/actions`, `/api/approvals`,
 * `/api/assumptions`, `/api/signals`, `/api/health`) never pulls it in at
 * module load time. DashClaw must work with zero LLM configuration.
 */

interface ActionForEmbedding {
  action_type?: string | null;
  declared_goal?: string | null;
  reasoning?: string | null;
  systems_touched?: string[] | null;
}

let _openai: any;
async function getOpenAI(): Promise<any> {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY || process.env.GUARD_LLM_KEY;
  if (!apiKey) {
    return null;
  }
  const { default: OpenAI } = await import('openai');
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/**
 * Check if Behavioral AI (embeddings) is enabled based on configuration.
 */
export function isEmbeddingsEnabled(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.GUARD_LLM_KEY);
}

/**
 * Generate an embedding for an agent action.
 * Concatenates action type, goal, and reasoning for context.
 */
export async function generateActionEmbedding(
  action: ActionForEmbedding,
): Promise<number[] | null> {
  if (!isEmbeddingsEnabled()) {
    return null;
  }
  const openai = await getOpenAI();
  if (!openai) {
    return null;
  }

  const text = `
    Type: ${action.action_type || 'unknown'}
    Goal: ${action.declared_goal || 'none'}
    Reasoning: ${action.reasoning || 'none'}
    Systems: ${(action.systems_touched || []).join(', ')}
  `.trim();

  // SECURITY: Prevent accidental secret exfiltration to third-party LLMs.
  const scanned = scanSensitiveData(text);
  const safeText = scanned.redacted;
  if (!scanned.clean) {
    console.warn(`[Embeddings] Redacted ${scanned.findings.length} sensitive pattern(s) from embedding input.`);
  }

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: safeText,
      encoding_format: "float",
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('[Embeddings] Failed to generate embedding:', (error as Error).message);
    return null;
  }
}

/**
 * Calculate cosine similarity between two vectors.
 * (Not strictly needed if using pgvector <=> operator, but useful for testing).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i]! * vecB[i]!;
    normA += vecA[i]! * vecA[i]!;
    normB += vecB[i]! * vecB[i]!;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
