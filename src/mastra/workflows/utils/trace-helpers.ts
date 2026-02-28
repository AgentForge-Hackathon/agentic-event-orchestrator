import { traceEventBus, traceContext } from '../../../tracing/index.js';
import type { TraceEvent } from '../../../tracing/index.js';

export function emitTrace(partial: Omit<TraceEvent, 'traceId'> & { traceId?: string }): void {
  const traceId = partial.traceId ?? traceContext.getStore() ?? 'unknown';
  traceEventBus.emit({ ...partial, traceId });
}

/** Format an ISO datetime string to HH:MM in Singapore Time (UTC+8) */
export function formatSGT(isoString: string): string {
  const d = new Date(isoString);
  // Singapore is UTC+8 — offset in ms
  const sgtMs = d.getTime() + 8 * 60 * 60 * 1000;
  const sgt = new Date(sgtMs);
  const h = sgt.getUTCHours().toString().padStart(2, '0');
  const m = sgt.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Tracks discovery start time per workflow run for accurate duration in completion trace */
export const discoveryStartTimes = new Map<string, number>();

/** Tracks ranking start time per workflow run for accurate duration in completion trace */
export const rankingStartTimes = new Map<string, number>();

/** Tracks planning start time per workflow run for accurate duration in completion trace */
export const planningStartTimes = new Map<string, number>();
