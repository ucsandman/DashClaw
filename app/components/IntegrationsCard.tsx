'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plug } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Stat } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

interface IntegrationItem {
  name: string;
  key: string;
  status: string;
}

export default function IntegrationsCard() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  const fetchIntegrations = useCallback(async () => {
    try {
      // Fetch settings and agent connections in parallel
      let settingsUrl = '/api/settings?category=integration';
      let connectionsUrl = '/api/agents/connections';
      if (agentId) {
        settingsUrl += `&agent_id=${encodeURIComponent(agentId)}`;
        connectionsUrl += `?agent_id=${encodeURIComponent(agentId)}`;
      }

      const [settingsRes, connectionsRes] = await Promise.all([
        fetch(settingsUrl),
        fetch(connectionsUrl).catch(() => null)
      ]);

      if (!settingsRes.ok) throw new Error('Failed to fetch');
      const settingsData = await settingsRes.json();

      const items: IntegrationItem[] = (settingsData.settings || []).map((s: any) => ({
        name: formatKeyName(s.key),
        key: s.key,
        status: s.hasValue ? 'connected' : 'configured'
      }));

      // Merge agent-reported connections
      if (connectionsRes?.ok) {
        const connData = await connectionsRes.json();
        const existingNames = new Set(items.map(i => i.name.toLowerCase()));
        for (const conn of (connData.connections || [])) {
          const providerName = conn.provider.charAt(0).toUpperCase() + conn.provider.slice(1);
          if (!existingNames.has(conn.provider.toLowerCase())) {
            existingNames.add(conn.provider.toLowerCase());
            items.push({
              name: providerName,
              key: `agent:${conn.provider}`,
              status: conn.status === 'active' ? 'agent_connected' : 'configured'
            });
          }
        }
      }

      setIntegrations(items);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const formatKeyName = (key: string) => {
    const prefixMap: Record<string, string> = {
      TELEGRAM: 'Telegram', GOOGLE: 'Google', GMAIL: 'Gmail', NOTION: 'Notion',
      GITHUB: 'GitHub', VERCEL: 'Vercel', TWITTER: 'Twitter/X', DISCORD: 'Discord',
      SLACK: 'Slack', STRIPE: 'Stripe', OPENAI: 'OpenAI', ANTHROPIC: 'Anthropic',
      ELEVENLABS: 'ElevenLabs', BRAVE: 'Brave Search', MOLTBOOK: 'Moltbook',
      SENTRY: 'Sentry', CLOUDFLARE: 'Cloudflare', SUPABASE: 'Supabase',
      PINECONE: 'Pinecone', REDIS: 'Redis', SENDGRID: 'SendGrid',
      RESEND: 'Resend', TWILIO: 'Twilio', LINEAR: 'Linear',
      AIRTABLE: 'Airtable', CALENDLY: 'Calendly', GROQ: 'Groq',
      TOGETHER: 'Together', REPLICATE: 'Replicate', HUGGINGFACE: 'HuggingFace',
      PERPLEXITY: 'Perplexity', RAILWAY: 'Railway', MONGODB: 'MongoDB',
      PLANETSCALE: 'PlanetScale', LEMONSQUEEZY: 'LemonSqueezy'
    };
    const prefix = key.split('_')[0];
    return (prefix && prefixMap[prefix]) || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  // Deduplicate by service name (multiple keys per service)
  const deduped: IntegrationItem[] = [];
  const seen = new Set<string>();
  for (const item of integrations) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      deduped.push(item);
    }
  }

  const connected = deduped.filter(i => i.status === 'connected').length;
  const agentConnected = deduped.filter(i => i.status === 'agent_connected').length;
  const total = deduped.length;

  if (loading) {
    return <CardSkeleton />;
  }

  const viewAllLink = (
    <Link href="/integrations" className="text-xs text-brand hover:text-brand-hover transition-colors duration-150">
      View All
    </Link>
  );

  // Each grid row ~72px, stat header ~56px, status footer ~28px
  const GRID_ROW_H = 72;
  const RESERVED_H = 90;
  const maxGridRows = tileHeight > 0 ? fitItems(tileHeight, GRID_ROW_H, RESERVED_H) : 3;
  const maxGridItems = maxGridRows * 4;
  const visibleIntegrations = deduped.slice(0, maxGridItems);
  const integrationOverflow = deduped.length - visibleIntegrations.length;

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Integrations<HelpIcon sectionKey="team" tip={HELP_TIPS['team']} /></span>} icon={Plug} action={total > 0 ? viewAllLink : undefined}>
        {/* The settings + connections fetches above ARE agent-scoped, so say
            so — the old "Org-wide" badge contradicted the filtered data. */}
        {agentId && <Badge variant="info" size="xs">Filtered</Badge>}
        {total === 0 && !agentId && (
          <Link href="/integrations" className="text-xs text-brand hover:text-brand-hover transition-colors duration-150">
            Setup
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState
            icon={Plug}
            title="No integrations configured"
            description="Integrations are managed in agent configs. Visit /integrations to add dashboard-level keys."
          />
        ) : (
          <div ref={sizeRef as React.RefObject<HTMLDivElement>} className="flex flex-col h-full min-h-0 space-y-4">
            {/* Connected count */}
            <Stat label="Connected" value={`${connected + agentConnected}/${total}`} />

            {/* Integration grid */}
            <div className="grid grid-cols-4 gap-2 auto-rows-min">
              {visibleIntegrations.map((integration, idx) => (
                <div
                  key={idx}
                  className={`bg-surface-tertiary p-2 rounded-lg flex flex-col items-center gap-1 border transition-colors duration-150 ${
                    integration.status === 'connected' ? 'border-green-500/20'
                      : integration.status === 'agent_connected' ? 'border-blue-500/20'
                      : 'border-zinc-500/20'
                  }`}
                  title={`${integration.name} - ${integration.status}`}
                >
                  <Plug size={16} className="text-secondary" />
                  <span className="text-[10px] text-secondary truncate w-full text-center">{integration.name}</span>
                  <div
                    className={`w-2 h-2 rounded-full ${
                      integration.status === 'connected' ? 'bg-status-success'
                        : integration.status === 'agent_connected' ? 'bg-status-info'
                        : 'bg-status-warning'
                    }`}
                  />
                </div>
              ))}
            </div>

            {/* Bottom status line */}
            <div className="flex items-center justify-between text-xs text-tertiary flex-shrink-0">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-status-success inline-block" />
                {connected} connected
              </span>
              {agentConnected > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-status-info inline-block" />
                  {agentConnected} agent
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-status-warning inline-block" />
                {total - connected - agentConnected} configured
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
