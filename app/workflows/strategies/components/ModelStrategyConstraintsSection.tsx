interface StrategyConstraints {
  costSensitivity: string;
  latencySensitivity: string;
  maxBudgetUsd: number;
  allowedProviders: string[];
  disallowedProviders: string[];
}

function parseProviderTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

interface ModelStrategyConstraintsSectionProps {
  constraints: StrategyConstraints;
  onConstraintsChange: (constraints: StrategyConstraints) => void;
}

export default function ModelStrategyConstraintsSection({
  constraints,
  onConstraintsChange,
}: ModelStrategyConstraintsSectionProps) {
  const updateField = (field: string, value: unknown) => {
    onConstraintsChange({ ...constraints, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
            Budget cap
          </label>
          <input
            aria-label="Budget cap"
            type="number"
            min="0"
            step="0.01"
            value={constraints.maxBudgetUsd}
            onChange={(event) => updateField('maxBudgetUsd', Number(event.target.value))}
            className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
            Latency sensitivity
          </label>
          <select
            aria-label="Latency sensitivity"
            value={constraints.latencySensitivity}
            onChange={(event) => updateField('latencySensitivity', event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
            Cost sensitivity
          </label>
          <select
            aria-label="Cost sensitivity"
            value={constraints.costSensitivity}
            onChange={(event) => updateField('costSensitivity', event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          >
            <option value="low">low</option>
            <option value="balanced">balanced</option>
            <option value="high-quality">high-quality</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
            Allowed providers
          </label>
          <input
            aria-label="Allowed providers"
            type="text"
            value={constraints.allowedProviders.join(', ')}
            onChange={(event) => updateField('allowedProviders', parseProviderTags(event.target.value))}
            className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
            placeholder="openai, anthropic"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
            Blocked providers
          </label>
          <input
            aria-label="Blocked providers"
            type="text"
            value={constraints.disallowedProviders.join(', ')}
            onChange={(event) => updateField('disallowedProviders', parseProviderTags(event.target.value))}
            className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
            placeholder="xai"
          />
        </div>
      </div>
    </div>
  );
}
