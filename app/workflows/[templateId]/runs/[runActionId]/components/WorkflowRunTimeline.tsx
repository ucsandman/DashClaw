'use client';

import WorkflowRunStepCard from './WorkflowRunStepCard';

interface WorkflowRunTimelineProps {
  steps?: any[];
  runStatus: string;
  onResumeFromStep?: (stepId: string) => void;
}

export default function WorkflowRunTimeline({ steps, runStatus, onResumeFromStep }: WorkflowRunTimelineProps) {
  if (!steps || steps.length === 0) {
    return <div className="text-sm text-tertiary">No steps recorded for this run.</div>;
  }

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <WorkflowRunStepCard
          key={step.step_result_id || step.step_id}
          step={step}
          runStatus={runStatus}
          onResumeFromStep={onResumeFromStep}
        />
      ))}
    </div>
  );
}
