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
      <PolicyCockpit />
    </PageLayout>
  );
}
