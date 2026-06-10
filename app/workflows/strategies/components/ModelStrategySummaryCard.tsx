interface ModelStrategySummaryCardProps {
  summary?: string;
}

export default function ModelStrategySummaryCard({ summary }: ModelStrategySummaryCardProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-secondary">
        Strategy summary
      </div>
      <p className="text-sm text-secondary">
        {summary || 'Define a primary model and operating constraints to preview the strategy.'}
      </p>
    </div>
  );
}
