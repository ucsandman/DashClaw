'use client';

import PageLayout from '../components/PageLayout';
import DoctorPanel from '../components/DoctorPanel';

export default function DoctorPage() {
  return (
    <PageLayout agentFilter={false}
      title="Doctor"
      subtitle="Instance diagnostics and one-click remediations"
      breadcrumbs={['Configure', 'Doctor']}
    >
      <DoctorPanel />
    </PageLayout>
  );
}
