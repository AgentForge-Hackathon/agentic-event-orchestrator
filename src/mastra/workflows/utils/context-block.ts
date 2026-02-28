/**
 * Builds a human-readable context block from ContextManager state for
 * injection into agent prompts.
 *
 * Each pipeline step can call `buildContextBlock(traceId)` to get a
 * summary of everything prior agents have decided, stored, or errored on.
 * The resulting string is prepended to the agent's prompt so the LLM has
 * full awareness of upstream decisions.
 */

import { contextRegistry } from '../../../context/index.js';
import { traceContext } from '../../../tracing/index.js';
import type { ContextManager, AgentStateUpdate, WorkflowPhase } from '../../../context/context-manager.js';

// ── Public helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the ContextManager for the current workflow run.
 * Returns `null` when no manager is registered (e.g. tests without full pipeline).
 */
export function getContextManager(overrideTraceId?: string): ContextManager | null {
  const id = overrideTraceId ?? traceContext.getStore();
  if (!id) return null;
  return contextRegistry.get(id) ?? null;
}

/**
 * Build a prompt-ready context block summarising everything the pipeline
 * has accumulated so far.
 *
 * Returns an empty string when no context is available (safe to concatenate).
 */
export async function buildContextBlock(overrideTraceId?: string): Promise<string> {
  const ctx = getContextManager(overrideTraceId);
  if (!ctx) return '';

  const [state, agents, phases] = await Promise.all([
    ctx.getWorkflowState(),
    ctx.getAgentStates(),
    ctx.getPhaseHistory(),
  ]);

  if (!state) return '';

  const sections: string[] = [];

  // ── Workflow identity ──
  sections.push(`Workflow: ${state.workflowId}`);
  sections.push(`Current phase: ${state.currentPhase}`);

  // ── Phase trajectory ──
  if (phases.length > 0) {
    const trajectory = phases.map((p: WorkflowPhase) => p.phase).join(' → ');
    sections.push(`Phase history: ${trajectory}`);
  }

  // ── Intent summary (if available) ──
  if (state.userIntent) {
    const intent = state.userIntent;
    sections.push(
      `User intent: ${intent.intentType} (confidence: ${Math.round(intent.confidence * 100)}%)`,
    );
    if (intent.extractedConstraints) {
      const c = intent.extractedConstraints;
      const parts: string[] = [];
      if (c.budget) parts.push(`budget $${c.budget.min ?? 0}-${c.budget.max ?? '∞'} ${c.budget.currency}`);
      if (c.partySize) parts.push(`party of ${c.partySize}`);
      if (c.date) parts.push(`date: ${c.date}`);
      if (c.preferredCategories?.length) parts.push(`categories: ${c.preferredCategories.join(', ')}`);
      if (parts.length > 0) sections.push(`Constraints: ${parts.join(' | ')}`);
    }
  }

  // ── Discovered events summary ──
  if (state.discoveredEvents && state.discoveredEvents.length > 0) {
    sections.push(`Discovered events: ${state.discoveredEvents.length} total`);
  }

  // ── Ranked events summary ──
  if (state.rankedEvents && state.rankedEvents.length > 0) {
    const topNames = state.rankedEvents
      .slice(0, 3)
      .map((e, i) => `${i + 1}. ${e.name}`)
      .join(', ');
    sections.push(`Top ranked events: ${topNames}`);
  }

  // ── Itinerary summary ──
  if (state.itinerary) {
    const itin = state.itinerary;
    sections.push(`Itinerary: "${itin.name ?? 'untitled'}" with ${itin.items?.length ?? 0} items`);
  }

  // ── Agent states ──
  if (agents.size > 0) {
    const agentLines = Array.from(agents.entries()).map(
      ([id, s]: [string, AgentStateUpdate]) => `  ${id}: ${s.status}`,
    );
    sections.push(`Agent states:\n${agentLines.join('\n')}`);
  }

  // ── Errors ──
  if (state.errors && state.errors.length > 0) {
    sections.push(`Errors so far: ${state.errors.join('; ')}`);
  }

  return `\n--- PIPELINE CONTEXT (from prior agents) ---\n${sections.join('\n')}\n--- END PIPELINE CONTEXT ---\n`;
}
