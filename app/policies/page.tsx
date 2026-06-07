'use client';

import { useCallback, useEffect, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { Skeleton } from '../components/ui/Skeleton';
import PolicyFrontDoor from './components/PolicyFrontDoor';
import PolicyConsole from './components/PolicyConsole';

interface PolicyRow {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  active: number;
  agent_ids: string | null;
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/policies');
      const data = res.ok ? await res.json() : { policies: [] };
      setPolicies((data.policies as PolicyRow[]) || []);
    } catch {
      setPolicies([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasGovernance = policies != null && policies.some((p) => p.active === 1);

  return (
    <PageLayout
      title="Policies"
      subtitle="Govern your agents with one decision"
      breadcrumbs={['Governance', 'Policies']}
      maturity="stable"
    >
      {policies == null ? (
        <div className="max-w-3xl space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : hasGovernance ? (
        <PolicyConsole policies={policies} onApplied={load} />
      ) : (
        <PolicyFrontDoor onApplied={load} />
      )}
    </PageLayout>
  );
}
