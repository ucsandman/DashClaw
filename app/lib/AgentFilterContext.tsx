'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { isDemoMode } from './isDemoMode';

export interface AgentFilterOption {
  agent_id: string;
  agent_name?: string | null;
  [key: string]: unknown;
}

export interface AgentFilterValue {
  agents: AgentFilterOption[];
  agentId: string | null;
  setAgentId: (id: string | null) => void;
  loading: boolean;
}

const AgentFilterContext = createContext<AgentFilterValue | null>(null);

export function AgentFilterProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentFilterOption[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null); // null = "All Agents"
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  // Deep-link adoption: read ?agent= once on mount (in an effect, not the
  // useState initializer, so server and hydration renders agree). The param
  // name is `agent`, not `agent_id` — pages own their local agent_id params
  // (e.g. /decisions shared links) and the global picker must not collide.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('agent');
    if (fromUrl) setAgentId(fromUrl);
  }, []);

  // Keep ?agent= in the URL: on selection change AND after client-side
  // navigation (Link navigations drop query params). history.replaceState
  // instead of useSearchParams/router avoids the Next 16 Suspense-boundary
  // requirement and adds no history entries.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get('agent');
    if (agentId ? current === agentId : current === null) return;
    if (agentId) url.searchParams.set('agent', agentId);
    else url.searchParams.delete('agent');
    window.history.replaceState(window.history.state, '', url);
  }, [agentId, pathname]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (error) {
      console.error('Failed to fetch agents:', error);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // This provider wraps every page, public marketing included. An anonymous
  // visitor has no session, so an unconditional /api/agents fetch put a
  // guaranteed 401 in every visitor's console. Gate on the effective session
  // (same probe useRealtime gates on); demo mode stays allowed — the demo
  // middleware serves /api/agents to anonymous visitors there.
  const { authenticated, settled } = useEffectiveRole();
  useEffect(() => {
    if (!settled) return;
    if (!authenticated && !isDemoMode()) {
      setAgents([]);
      setLoading(false);
      return;
    }
    fetchAgents();
  }, [settled, authenticated, fetchAgents]);

  return (
    <AgentFilterContext.Provider value={{ agents, agentId, setAgentId, loading }}>
      {children}
    </AgentFilterContext.Provider>
  );
}

export function useAgentFilter(): AgentFilterValue {
  const ctx = useContext(AgentFilterContext);
  if (!ctx) {
    // Return defaults if used outside provider (non-dashboard pages)
    return { agents: [], agentId: null, setAgentId: () => {}, loading: false };
  }
  return ctx;
}
