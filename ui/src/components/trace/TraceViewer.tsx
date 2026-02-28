import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import type { TraceEvent } from '@/types/trace';
import { useTraceStream } from '@/hooks/useTraceStream';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { PipelineProgress } from './PipelineProgress';
import { SpanCard } from './SpanCard';
import { ActiveAgentBanner } from './ActiveAgentBanner';
import { PlanApprovalCard } from './PlanApprovalCard';

interface TraceViewerProps {
  workflowId: string;
  onComplete?: () => void;
}

interface TreeNode {
  event: TraceEvent;
  children: TreeNode[];
}

function buildTree(events: TraceEvent[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const event of events) {
    map.set(event.id, { event, children: [] });
  }

  for (const event of events) {
    const node = map.get(event.id)!;
    if (event.parentId && map.has(event.parentId)) {
      map.get(event.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function renderTree(
  nodes: TreeNode[],
  expandedEventId: string | null,
  onToggleExpand: (eventId: string) => void,
  depth = 0,
): React.ReactNode[] {
  return nodes.map((node) => (
    <SpanCard
      key={node.event.id}
      event={node.event}
      depth={depth}
      expanded={node.event.id === expandedEventId}
      onToggleExpand={onToggleExpand}
    >
      {node.children.length > 0
        ? renderTree(node.children, expandedEventId, onToggleExpand, depth + 1)
        : undefined}
    </SpanCard>
  ));
}

export function TraceViewer({ workflowId, onComplete }: TraceViewerProps) {
  const { events, status, error } = useTraceStream(workflowId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<'approved' | 'rejected' | null>(null);

  const visibleEvents = useMemo(
    () =>
      events
        .filter((e) => e.type !== 'model_step')
        .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    [events],
  );

  const tree = useMemo(() => buildTree(visibleEvents), [visibleEvents]);

  const resultEvent = useMemo(
    () =>
      events.find(
        (e) =>
          e.type === 'workflow_run' &&
          e.name === 'pipeline-result' &&
          e.status === 'completed',
      ),
    [events],
  );

  // Detect plan_approval events
  const approvalEvent = useMemo(
    () =>
      events.find(
        (e) => e.type === 'plan_approval' && e.status === 'awaiting_approval',
      ),
    [events],
  );

  const approvalResolved = useMemo(
    () =>
      events.find(
        (e) =>
          e.type === 'plan_approval' &&
          (e.status === 'approved' || e.status === 'rejected'),
      ),
    [events],
  );

  // Sync external resolution (SSE) into local state
  useEffect(() => {
    if (approvalResolved && !approvalDecision) {
      setApprovalDecision(approvalResolved.status as 'approved' | 'rejected');
    }
  }, [approvalResolved, approvalDecision]);

  // Pipeline completed with approved plan — show continue button
  const showContinueButton = status === 'done' && approvalDecision === 'approved' && !!onComplete;

  const showApprovalCard = !!approvalEvent && !approvalResolved && approvalDecision === null;
  const showResolvedCard = !!approvalEvent && (!!approvalResolved || approvalDecision !== null);

  const handleApprove = useCallback(async () => {
    setApprovalSubmitting(true);
    const res = await apiClient.post<{ workflowId: string; approved: boolean }>(
      `/workflow/${workflowId}/approve`,
      { approved: true },
    );
    if (res.error) {
      toast.error(`Failed to approve: ${res.error}`);
    } else {
      setApprovalDecision('approved');
      toast.success('Plan approved! Continuing to execution…');
    }
    setApprovalSubmitting(false);
  }, [workflowId]);

  const handleReject = useCallback(async () => {
    setApprovalSubmitting(true);
    const res = await apiClient.post<{ workflowId: string; approved: boolean }>(
      `/workflow/${workflowId}/approve`,
      { approved: false },
    );
    if (res.error) {
      toast.error(`Failed to reject: ${res.error}`);
    } else {
      setApprovalDecision('rejected');
      toast('Plan rejected.');
    }
    setApprovalSubmitting(false);
  }, [workflowId]);

  const resultCount =
    resultEvent?.metadata?.resultCount ?? resultEvent?.metadata?.eventCount;

  // The auto-expanded event: last visible event that has a durationMs
  const autoExpandId = useMemo(() => {
    for (let i = visibleEvents.length - 1; i >= 0; i--) {
      if (visibleEvents[i].durationMs != null) {
        return visibleEvents[i].id;
      }
    }
    return null;
  }, [visibleEvents]);
  // Manual toggle override — null means "use autoExpandId"
  const [manualExpandId, setManualExpandId] = useState<string | null>(null);

  // Reset manual override whenever auto-expand target changes (new trace arrived)
  const prevAutoRef = useRef(autoExpandId);
  if (prevAutoRef.current !== autoExpandId) {
    prevAutoRef.current = autoExpandId;
    setManualExpandId(null);
  }

  // Resolved: manual override wins, otherwise auto
  const expandedEventId = manualExpandId ?? autoExpandId;

  const handleToggleExpand = useCallback((eventId: string) => {
    // If already expanded, collapse; otherwise expand this one
    setManualExpandId((prev) => (prev === eventId ? '' : eventId));
  }, []);
  // Auto-scroll: scroll to top when approval card shows, otherwise bottom
  useEffect(() => {
    if (scrollRef.current) {
      if (showApprovalCard) {
        scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }
  }, [events, showApprovalCard]);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="shrink-0">
        <PipelineProgress events={events} />
      </div>
      <div className="shrink-0">
        <ActiveAgentBanner events={events} />
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
        {visibleEvents.length === 0 && (status === 'connecting' || status === 'connected') && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mb-2" aria-hidden="true" />
            <p className="text-sm">Waiting for agent activity...</p>
          </div>
        )}

        {/* Show approval card when plan_approval event is awaiting */}
        {(showApprovalCard || showResolvedCard) && approvalEvent?.metadata?.approvalData && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <PlanApprovalCard
              approvalData={approvalEvent.metadata.approvalData}
              onApprove={handleApprove}
              onReject={handleReject}
              submitting={approvalSubmitting}
              decision={approvalDecision}
            />
          </motion.div>
        )}

        {/* Hide trace tree while awaiting approval, show otherwise */}
        {!showApprovalCard && (
          <AnimatePresence mode="popLayout">
            {renderTree(tree, expandedEventId, handleToggleExpand)}
          </AnimatePresence>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-center gap-2 text-sm py-1">
        {status === 'connecting' && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">Connecting...</span>
          </>
        )}
        {status === 'connected' && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            <span className="text-primary font-medium">Agents working...</span>
          </>
        )}
        {status === 'done' && !showContinueButton && (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
            <span className="text-green-600 dark:text-green-400 font-medium">
              Complete!
              {resultCount != null && ` — ${resultCount} results found`}
            </span>
          </>
        )}
        {showContinueButton && (
          <Button onClick={onComplete} size="default" className="gap-2">
            View Itineraries
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <span className="text-destructive font-medium">
              {error ?? 'Connection lost'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
