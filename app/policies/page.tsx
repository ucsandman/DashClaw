import { Suspense } from 'react';
import type { Metadata } from 'next';
import PageLayout from '../components/PageLayout';
import PolicyWorkbench from './components/PolicyWorkbench';

export const metadata: Metadata = {
  title: 'Policies',
};

export default function PoliciesPage() {
  return (
    <PageLayout agentFilter={false}
      title="Policies"
      subtitle="Every rule that governs your agents, in one place"
      breadcrumbs={['Governance', 'Policies']}
      maturity="stable"
    >
      <Suspense fallback={<div className="text-sm text-tertiary">Loading policy posture…</div>}>
        <PolicyWorkbench />
      </Suspense>
    </PageLayout>
  );
}
