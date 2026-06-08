import { Suspense } from 'react';
import PageLayout from '../components/PageLayout';
import PolicyCockpit from './components/PolicyCockpit';

export default function PoliciesPage() {
  return (
    <PageLayout
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
