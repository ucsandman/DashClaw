interface ModelStrategyBasicsSectionProps {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}

export default function ModelStrategyBasicsSection({
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: ModelStrategyBasicsSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
          Name <span className="text-error">*</span>
        </label>
        <input
          aria-label="Name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          required
          className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          placeholder="Balanced default"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-secondary">
          Description
        </label>
        <textarea
          aria-label="Description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          placeholder="GPT-4.1 primary, Claude Sonnet 4 fallback"
        />
      </div>
    </div>
  );
}
