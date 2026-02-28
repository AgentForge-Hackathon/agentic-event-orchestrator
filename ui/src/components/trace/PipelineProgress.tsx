import { Fragment, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Search, Star, Calendar, Rocket, Check, AlertCircle } from 'lucide-react';
import type { TraceEvent, PipelineStep } from '@/types/trace';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const STEPS: { key: PipelineStep; label: string; agentName: string; icon: typeof Brain }[] = [
  { key: 'intent', label: 'Intent', agentName: 'Intent Agent', icon: Brain },
  { key: 'discovery', label: 'Discovery', agentName: 'Discovery Agent', icon: Search },
  { key: 'recommendation', label: 'Ranking', agentName: 'Recommendation Agent', icon: Star },
  { key: 'planning', label: 'Planning', agentName: 'Planning Agent', icon: Calendar },
  { key: 'execution', label: 'Execution', agentName: 'Execution Agent', icon: Rocket },
];

type StepStatus = 'pending' | 'running' | 'completed' | 'error';

function deriveStepStatuses(events: TraceEvent[]): Record<PipelineStep, StepStatus> {
  const statuses: Record<PipelineStep, StepStatus> = {
    intent: 'pending',
    discovery: 'pending',
    recommendation: 'pending',
    planning: 'pending',
    execution: 'pending',
  };

  for (const event of events) {
    const step = event.metadata?.pipelineStep;
    if (!step) continue;

    const current = statuses[step];
    if (event.status === 'error' || event.status === 'booking_failed') {
      statuses[step] = 'error';
    } else if (
      (event.status === 'completed' || event.status === 'booking_completed') &&
      current !== 'error'
    ) {
      statuses[step] = 'completed';
    } else if (
      (event.status === 'started' || event.status === 'running' || event.status === 'booking_started' || event.status === 'booking_progress') &&
      current === 'pending'
    ) {
      statuses[step] = 'running';
    }
  }

  return statuses;
}

function deriveStepSummaries(events: TraceEvent[]): Record<PipelineStep, string | null> {
  const summaries: Record<PipelineStep, string | null> = {
    intent: null,
    discovery: null,
    recommendation: null,
    planning: null,
    execution: null,
  };

  for (const event of events) {
    const step = event.metadata?.pipelineStep;
    if (!step) continue;

    if ((event.status === 'completed' || event.status === 'booking_completed') && event.metadata?.outputSummary) {
      summaries[step] = event.metadata.outputSummary;
    } else if ((event.status === 'started' || event.status === 'booking_started') && event.metadata?.inputSummary && !summaries[step]) {
      summaries[step] = event.metadata.inputSummary;
    }
  }

  return summaries;
}

function deriveAgentStatuses(events: TraceEvent[]): Record<PipelineStep, string | null> {
  const statuses: Record<PipelineStep, string | null> = {
    intent: null,
    discovery: null,
    recommendation: null,
    planning: null,
    execution: null,
  };

  for (const event of events) {
    const step = event.metadata?.pipelineStep;
    if (!step) continue;

    if (event.metadata?.agentStatus) {
      statuses[step] = event.metadata.agentStatus;
    }
  }

  return statuses;
}

interface PipelineProgressProps {
  events: TraceEvent[];
}

export function PipelineProgress({ events }: PipelineProgressProps) {
  const stepStatuses = useMemo(() => deriveStepStatuses(events), [events]);
  const stepSummaries = useMemo(() => deriveStepSummaries(events), [events]);
  const agentStatuses = useMemo(() => deriveAgentStatuses(events), [events]);

  return (
    <TooltipProvider delayDuration={200}>
      {/* Grid: one column per step, plus connector columns between steps */}
      <div
        className="grid items-start"
        style={{ gridTemplateColumns: STEPS.map((_, i) => i < STEPS.length - 1 ? 'auto 1fr' : 'auto').join(' ') }}
        role="list"
        aria-label="Pipeline progress"
      >
        {STEPS.map((step, i) => {
          const status = stepStatuses[step.key];
          const summary = stepSummaries[step.key];
          const agentActivity = agentStatuses[step.key];
          const Icon = step.icon;
          const isActive = status === 'running';
          const isDone = status === 'completed';

          const iconNode = (
            <div
              className={`relative flex items-center justify-center h-9 w-9 rounded-full border-2 transition-colors shrink-0 ${
                isDone
                  ? 'border-green-500 bg-green-500/10'
                  : isActive
                    ? 'border-primary bg-primary/10'
                    : status === 'error'
                      ? 'border-destructive bg-destructive/10'
                      : 'border-muted bg-muted/50'
              }`}
            >
              {isDone ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  <Check className="h-4 w-4 text-green-500" aria-hidden="true" />
                </motion.div>
              ) : status === 'error' ? (
                <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
              ) : isActive ? (
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                </motion.div>
              ) : (
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              {isActive && (
                <>
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-primary"
                    animate={{ opacity: [1, 0.3, 1], scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <motion.div
                    className="absolute inset-[-3px] rounded-full bg-primary/10 blur-sm"
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </>
              )}
            </div>
          );

          const stepContent = (
            <div className="flex flex-col items-center w-20" role="listitem">
              {iconNode}
              <div className="flex flex-col items-center mt-1.5 w-full">
                <span
                  className={`text-xs font-medium leading-tight text-center ${
                    isDone
                      ? 'text-green-600 dark:text-green-400'
                      : isActive
                        ? 'text-primary'
                        : status === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
                <AnimatePresence>
                  {(isActive || isDone) && (
                    <motion.span
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className={`text-[10px] leading-snug text-center w-full ${
                        isActive ? 'text-primary/70' : 'text-muted-foreground'
                      }`}
                    >
                      {step.agentName}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );

          const wrappedStep = (summary || (isActive && agentActivity)) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
                  {stepContent}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-xs whitespace-pre-line">
                {isActive && agentActivity ? (
                  <span className="font-medium">{agentActivity}</span>
                ) : (
                  summary
                )}
              </TooltipContent>
            </Tooltip>
          ) : (
            stepContent
          );

          // Connector line between steps — pinned to icon vertical center (h-9 = 2.25rem → center at 1.125rem)
          const connector = i < STEPS.length - 1 ? (
            <div className="h-0.5 self-start" style={{ marginTop: 'calc(1.125rem - 1px)' }}>
              <div
                className={`h-0.5 w-full transition-colors duration-500 ${
                  stepStatuses[STEPS[i + 1].key] !== 'pending'
                    ? 'bg-primary'
                    : isDone
                      ? 'bg-primary'
                      : 'bg-muted'
                }`}
              />
            </div>
          ) : null;

          return (
            <Fragment key={step.key}>{wrappedStep}{connector}</Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
