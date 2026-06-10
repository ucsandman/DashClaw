import {
  getDefaultProviderModel,
  getProviderModelOptions,
  getProviderOptions,
} from '../../lib/providers/providerRegistry';

interface ProviderOption {
  value: string;
  label: string;
}

interface TaskModeOverride {
  taskMode: string;
  provider: string;
  model: string;
}

const providerOptions: ProviderOption[] = getProviderOptions();

interface TaskModeOverrideRowProps {
  override: TaskModeOverride;
  index: number;
  onChange: (index: number, field: string, value: string) => void;
  onProviderChange: (index: number, provider: string) => void;
  onRemove: (index: number) => void;
}

function TaskModeOverrideRow({ override, index, onChange, onProviderChange, onRemove }: TaskModeOverrideRowProps) {
  const modelOptions: ProviderOption[] = getProviderModelOptions(override.provider);

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/20 p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-tertiary">
          Task mode
        </label>
        <input
          aria-label={`Task mode ${index + 1}`}
          type="text"
          value={override.taskMode}
          onChange={(event) => onChange(index, 'taskMode', event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          placeholder="research"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-tertiary">
          Provider
        </label>
        <select
          aria-label={`Task mode provider ${index + 1}`}
          value={override.provider}
          onChange={(event) => onProviderChange(index, event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
        >
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-tertiary">
          Model
        </label>
        <select
          aria-label={`Task mode model ${index + 1}`}
          value={override.model}
          onChange={(event) => onChange(index, 'model', event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
        >
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-secondary hover:bg-white/5"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

interface ModelStrategyAdvancedSectionProps {
  open: boolean;
  onToggle: () => void;
  warning?: string | null;
  taskModes?: TaskModeOverride[];
  onTaskModesChange?: (taskModes: TaskModeOverride[]) => void;
  rawConfigText?: string;
  showRawConfig?: boolean;
  onToggleRawConfig?: () => void;
  onRawConfigTextChange?: (rawConfigText: string) => void;
  children?: React.ReactNode;
}

export default function ModelStrategyAdvancedSection({
  open,
  onToggle,
  warning = null,
  taskModes = [],
  onTaskModesChange,
  rawConfigText = '',
  showRawConfig = false,
  onToggleRawConfig,
  onRawConfigTextChange,
  children,
}: ModelStrategyAdvancedSectionProps) {
  const handleTaskModeChange = (index: number, field: string, value: string) => {
    if (!onTaskModesChange) return;
    const nextTaskModes = taskModes.map((taskMode, taskModeIndex) =>
      taskModeIndex === index ? { ...taskMode, [field]: value } : taskMode
    );
    onTaskModesChange(nextTaskModes);
  };

  const handleTaskModeRemove = (index: number) => {
    if (!onTaskModesChange) return;
    onTaskModesChange(taskModes.filter((_, taskModeIndex) => taskModeIndex !== index));
  };

  const handleTaskModeProviderChange = (index: number, provider: string) => {
    if (!onTaskModesChange) return;
    onTaskModesChange(
      taskModes.map((taskMode, taskModeIndex) =>
        taskModeIndex === index
          ? {
              ...taskMode,
              provider,
              model: getDefaultProviderModel(provider, 'model_strategies' as unknown as null) || '',
            }
          : taskMode
      )
    );
  };

  const handleTaskModeAdd = () => {
    if (!onTaskModesChange) return;
    const provider = 'openai';
    onTaskModesChange([
      ...taskModes,
      {
        taskMode: '',
        provider,
        model: getDefaultProviderModel(provider, 'model_strategies' as unknown as null) || '',
      },
    ]);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-secondary">
            Advanced task-mode overrides
          </div>
          <p className="mt-1 text-xs text-tertiary">
            Optional per-task overrides and raw fallback live here. Most strategies do not need this.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5"
        >
          {open ? 'Hide advanced' : 'Show advanced'}
        </button>
      </div>
      {warning ? (
        <div className="mt-4 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-sm text-warning">
          {warning}
        </div>
      ) : null}
      {open ? (
        <div className="mt-4 space-y-4">
          {onTaskModesChange ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wider text-secondary">
                  Task-mode overrides
                </div>
                <button
                  type="button"
                  onClick={handleTaskModeAdd}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5"
                >
                  Add task mode
                </button>
              </div>
              {taskModes.length > 0 ? (
                taskModes.map((override, index) => (
                  <TaskModeOverrideRow
                    key={`${index}-${override.taskMode}-${override.provider}-${override.model}`}
                    override={override}
                    index={index}
                    onChange={handleTaskModeChange}
                    onProviderChange={handleTaskModeProviderChange}
                    onRemove={handleTaskModeRemove}
                  />
                ))
              ) : (
                <div className="text-sm text-tertiary">
                  No task-mode overrides configured.
                </div>
              )}
            </div>
          ) : null}

          {onToggleRawConfig ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={onToggleRawConfig}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/5"
              >
                {showRawConfig ? 'Hide raw JSON' : 'Show raw JSON'}
              </button>
              {showRawConfig ? (
                <textarea
                  aria-label="Raw config JSON"
                  value={rawConfigText}
                  onChange={(event) => onRawConfigTextChange?.(event.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-secondary focus:border-brand focus:outline-none"
                />
              ) : null}
            </div>
          ) : null}

          {children}
        </div>
      ) : null}
    </div>
  );
}
