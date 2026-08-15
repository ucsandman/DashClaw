import { Suspense } from 'react';
import type { Metadata } from 'next';
import PageLayout from '../../components/PageLayout';
import PackGallery from './PackGallery';

export const metadata: Metadata = {
  title: 'Policy Packs',
};

export default function PolicyPacksPage() {
  return (
    <PageLayout agentFilter={false}
      title="Policy packs"
      subtitle="Curated rule sets — preview one against your own history, then install it in one click"
      breadcrumbs={['Governance', 'Policies', 'Packs']}
      maturity="stable"
    >
      <Suspense fallback={<div className="text-sm text-tertiary">Loading pack catalog…</div>}>
        <PackGallery />
      </Suspense>
    </PageLayout>
  );
}
