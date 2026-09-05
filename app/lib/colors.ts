// Shared agent color utility — consistent hash-based color for agent badges
const agentColors = [
  'bg-zinc-500/10 text-secondary border-zinc-500/20',
  'bg-info-subtle text-info border-blue-500/20',
  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'bg-success-subtle text-success border-success/20',
  'bg-warning-subtle text-warning border-warning/20',
  'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'bg-status-error/10 text-error border-rose-500/20',
  'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
];

const agentColorCache = new Map<string, string>();

export function getAgentColor(agentId: string): string {
  const cached = agentColorCache.get(agentId);
  if (cached) return cached;
  let hash = 0;
  for (let i = 0; i < (agentId || '').length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  const color = agentColors[Math.abs(hash) % agentColors.length] as string;
  agentColorCache.set(agentId, color);
  return color;
}
