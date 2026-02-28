import type {
  ObservabilityExporter,
  TracingEvent,
  TracingEventType,
  AnyExportedSpan,
  SpanType,
} from '@mastra/core/observability';

import {
  traceEventBus,
  type TraceEvent,
  type PipelineStep,
  type ReasoningStep,
  type Decision,
} from './sse-exporter.js';

/**
 * Maps a Mastra SpanType enum value to our simplified TraceEvent type string.
 */
function mapSpanType(spanType: SpanType): TraceEvent['type'] {
  const typeStr = String(spanType);
  const mapping: Record<string, TraceEvent['type']> = {
    agent_run: 'agent_run',
    tool_call: 'tool_call',
    mcp_tool_call: 'tool_call',
    workflow_run: 'workflow_run',
    workflow_step: 'workflow_step',
    workflow_parallel: 'workflow_parallel',
    workflow_conditional: 'workflow_step',
    workflow_conditional_eval: 'workflow_step',
    workflow_loop: 'workflow_step',
    workflow_sleep: 'workflow_step',
    workflow_wait_event: 'workflow_step',
    model_generation: 'model_generation',
    model_step: 'model_step',
    model_chunk: 'model_step',
    processor_run: 'generic',
    generic: 'generic',
  };
  return mapping[typeStr] ?? 'generic';
}

/**
 * Maps a Mastra TracingEventType to our TraceEvent status.
 */
function mapStatus(
  eventType: TracingEventType,
  span: AnyExportedSpan,
): TraceEvent['status'] {
  const typeStr = String(eventType);
  if (typeStr === 'span_ended') {
    return span.errorInfo ? 'error' : 'completed';
  }
  if (typeStr === 'span_started') {
    return 'started';
  }
  return 'running';
}

/**
 * Extracts metadata from a Mastra span for the frontend trace viewer.
 */
function extractMetadata(
  span: AnyExportedSpan,
): TraceEvent['metadata'] {
  const meta: TraceEvent['metadata'] = {};
  const attrs = span.attributes as Record<string, unknown> | undefined;
  const spanMeta = span.metadata as Record<string, unknown> | undefined;

  // Model info
  if (attrs) {
    if ('model' in attrs && typeof attrs.model === 'string') {
      meta.model = attrs.model;
    }
    if ('usage' in attrs && attrs.usage && typeof attrs.usage === 'object') {
      const usage = attrs.usage as Record<string, unknown>;
      meta.tokenUsage = {
        prompt: (usage.inputTokens as number) ?? 0,
        completion: (usage.outputTokens as number) ?? 0,
        total:
          ((usage.inputTokens as number) ?? 0) +
          ((usage.outputTokens as number) ?? 0),
      };
    }
  }

  // Copy custom metadata (reasoning, confidence, pipelineStep, etc.)
  if (spanMeta) {
    if ('reasoning' in spanMeta && typeof spanMeta.reasoning === 'string') {
      meta.reasoning = spanMeta.reasoning;
    }
    if ('confidence' in spanMeta && typeof spanMeta.confidence === 'number') {
      meta.confidence = spanMeta.confidence;
    }
    if ('inputSummary' in spanMeta && typeof spanMeta.inputSummary === 'string') {
      meta.inputSummary = spanMeta.inputSummary;
    }
    if ('outputSummary' in spanMeta && typeof spanMeta.outputSummary === 'string') {
      meta.outputSummary = spanMeta.outputSummary;
    }
    if ('resultCount' in spanMeta && typeof spanMeta.resultCount === 'number') {
      meta.resultCount = spanMeta.resultCount;
    }
    if ('pipelineStep' in spanMeta && typeof spanMeta.pipelineStep === 'string') {
      meta.pipelineStep = spanMeta.pipelineStep as PipelineStep;
    }
    if ('reasoningSteps' in spanMeta && Array.isArray(spanMeta.reasoningSteps)) {
      meta.reasoningSteps = spanMeta.reasoningSteps as ReasoningStep[];
    }
    if ('decisions' in spanMeta && Array.isArray(spanMeta.decisions)) {
      meta.decisions = spanMeta.decisions as Decision[];
    }
  }

  // Only return metadata if it has any keys
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Custom Mastra ObservabilityExporter that maps Mastra spans to TraceEvents
 * and emits them to the TraceEventBus for SSE streaming.
 */
export class SSETracingExporter implements ObservabilityExporter {
  readonly name = 'sse-tracing-exporter';

  init(): void {
    console.log('[sse-exporter] Initialized');
  }

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    const { exportedSpan } = event;

    // Skip internal/chunk spans to reduce noise
    const spanType = mapSpanType(exportedSpan.type);
    if (spanType === 'model_step') return; // Too granular for the UI

    const status = mapStatus(event.type as TracingEventType, exportedSpan);

    const traceEvent: TraceEvent = {
      id: exportedSpan.id,
      traceId: exportedSpan.traceId,
      parentId: exportedSpan.parentSpanId,
      type: spanType,
      name: exportedSpan.name,
      status,
      startedAt: exportedSpan.startTime.toISOString(),
      completedAt: exportedSpan.endTime?.toISOString(),
      durationMs:
        exportedSpan.endTime && exportedSpan.startTime
          ? exportedSpan.endTime.getTime() - exportedSpan.startTime.getTime()
          : undefined,
      metadata: extractMetadata(exportedSpan),
      error: exportedSpan.errorInfo?.message,
    };

    traceEventBus.emit(traceEvent);
  }

  async flush(): Promise<void> {
    // No buffering — events are emitted immediately
  }

  async shutdown(): Promise<void> {
    console.log('[sse-exporter] Shutdown');
  }
}
