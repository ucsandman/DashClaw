import PageLayout from '../../components/PageLayout';
import CustomTab from '../components/CustomTab';

export default function PolicyRulesPage() {
  return (
    <PageLayout
      title="Custom rules"
      subtitle="Bespoke guard rules layered on top of your mode and shields"
      breadcrumbs={['Governance', 'Policies', 'Rules']}
      maturity="stable"
    >
      <CustomTab />
    </PageLayout>
  );
}
