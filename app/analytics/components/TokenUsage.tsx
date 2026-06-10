import { formatCost, formatTokens } from '../../lib/formatCost';
import { EntityLink } from '../../components/context-menu/EntityLink';

interface TokenUsageProps {
  tokens: any;
}

export default function TokenUsage({ tokens }: TokenUsageProps) {
  const noTokenData = !tokens || (tokens.total || 0) === 0;

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Token Usage</div>

      {noTokenData ? (
        <div className="py-6 text-sm text-secondary">
          No token usage reported yet.
          <div className="mt-1 text-xs text-tertiary max-w-2xl">
            Claude Code sessions capture token usage automatically via the <code className="font-mono text-secondary">Stop</code> hook. Other agents should PATCH actions with <code className="font-mono text-secondary">tokens_in</code>, <code className="font-mono text-secondary">tokens_out</code>, and <code className="font-mono text-secondary">model</code> — cost is derived from the configured pricing table.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div>
            <div className="text-[10px] text-tertiary">Input Tokens</div>
            <div className="text-lg font-semibold text-white">{formatTokens(tokens.total_in)}</div>
          </div>
          <div>
            <div className="text-[10px] text-tertiary">Output Tokens</div>
            <div className="text-lg font-semibold text-white">{formatTokens(tokens.total_out)}</div>
          </div>
          <div>
            <div className="text-[10px] text-tertiary">Total</div>
            <div className="text-lg font-semibold text-white">{formatTokens(tokens.total)}</div>
          </div>
          <div>
            <div className="text-[10px] text-tertiary">Cost / 1M Tokens</div>
            <div className="text-lg font-semibold text-white">{formatCost(tokens.cost_per_million)}</div>
          </div>
        </div>
      )}

      {!noTokenData && tokens.top_consumers?.length > 0 && (
        <div>
          <div className="text-[10px] text-tertiary uppercase tracking-widest mb-2">Top Consumers</div>
          <div className="space-y-2">
            {tokens.top_consumers.map((c: any) => (
              <div key={c.agent_id} className="flex items-center justify-between text-xs">
                <EntityLink type="agent" id={c.agent_id} className="text-secondary">
                  {c.agent_name || c.agent_id}
                </EntityLink>
                <span className="text-secondary">
                  {formatTokens(c.total_tokens)} tokens &middot; {formatCost(c.cost)} &middot; avg {formatTokens(c.avg_per_action)}/action
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
