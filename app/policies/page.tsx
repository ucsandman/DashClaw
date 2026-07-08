import { Suspense } from 'react';
import type { Metadata } from 'next';
import PageLayout from '../components/PageLayout';
import PolicyCockpit from './components/PolicyCockpit';

export const metadata: Metadata = {
  title: 'Policies',
};

export default function PoliciesPage() {
  return (
    <PageLayout agentFilter={false}
      title="Policies"
      subtitle="Govern your agents with one decision"
      breadcrumbs={['Governance', 'Policies']}
      maturity="stable"
    >
      <Suspense fallback={<div className="text-sm text-tertiary">Loading policy posture…</div>}>
        <PolicyCockpit />
      </Suspense>
    </PageLayout>
  );
}
