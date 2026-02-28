import { useEffect, useRef, useState, useCallback } from 'react';
import type { TraceEvent, TraceStreamStatus } from '@/types/trace';

const BASE_URL = (import.meta.env.VITE_API_URL ?? "") + "/api";

interface UseTraceStreamReturn {
  events: TraceEvent[];
  status: TraceStreamStatus;
  error: string | null;
}

/**
 * SSE hook that connects to GET /api/traces/stream/:workflowId
 * and accumulates TraceEvent[] in state.
 *
 * - Connects on mount when workflowId is provided
 * - Replays historical events + receives live events
 * - Auto-closes EventSource on completion, error, or unmount
 */
export function useTraceStream(workflowId: string | null): UseTraceStreamReturn {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [status, setStatus] = useState<TraceStreamStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!workflowId) return;

    setEvents([]);
    setStatus('connecting');
    setError(null);

    const url = `${BASE_URL}/traces/stream/${encodeURIComponent(workflowId)}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setStatus('connected');
    };

    source.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;

        // Handle control events
        if (data.type === 'connected') {
          setStatus('connected');
          return;
        }
        if (data.type === 'done') {
          setStatus('done');
          cleanup();
          return;
        }

        // Regular TraceEvent
        const event = data as unknown as TraceEvent;
        if (event.id && event.name) {
          setEvents((prev) => {
            // Update existing event (same id, new status) or append
            const idx = prev.findIndex((e) => e.id === event.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = event;
              return updated;
            }
            return [...prev, event];
          });
        }
      } catch {
        // Ignore unparseable messages (heartbeats, etc.)
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects; if readyState is CLOSED it won't
      if (source.readyState === EventSource.CLOSED) {
        setStatus('error');
        setError('Connection to trace stream closed unexpectedly');
        cleanup();
      }
    };

    return cleanup;
  }, [workflowId, cleanup]);

  return { events, status, error };
}
