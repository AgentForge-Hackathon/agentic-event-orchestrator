# Agentic Itinerary Planner — Project Knowledge Base

> **Pitch**: "We didn't build a planner. We built an autonomous personal logistics agent that executes real-world plans from start to finish — with full explainability."

---

## Project Overview

An **autonomous itinerary + logistics agent** that goes beyond recommendations by **taking actions**: checking availability, preparing bookings, and scheduling reminders. Built for the [SgAI Hackathon](https://luma.com/sgaihackthon).

### Core Capabilities
- **Discover** events, restaurants, attractions, and activities from the web
- **Rank** options based on constraints: budget, distance, timing, ratings, weather
- **Optimize** a schedule: time blocks, travel time, dependencies
- **Execute** actions: reservation checks, form filling, booking links or bookings

### Chosen Use Case
**Date night / short trip planner** — fast, visual, easy to demo in 2 minutes.

### Key Differentiator
Most planners are recommendation engines. This is an **Autonomous Execution System** with **Intelligent Traces** for full explainability.

---

## Current Implementation Status

### Built (Scaffold Layer)
- [x] **Type definitions** — Full Zod schemas for all domain objects (`src/types/index.ts`)
  - Location, TimeSlot, PriceRange, Event, UserConstraints, Itinerary, ItineraryItem, BookingAction, UserIntent, AgentMessage, WorkflowState, WeatherCondition, PlanFormData
- [x] **5 Mastra Agents** (`src/mastra/agents/`) — Restructured from hand-rolled classes to Mastra `Agent` primitives with `@ai-sdk/openai` model provider
  - `intentAgent` — GPT-4o-mini, uses `parseIntentTool` to map PlanFormData → UserConstraints
  - `discoveryAgent` — GPT-4o-mini, uses `searchEventbriteTool`, `searchEventfindaTool`, `deduplicateEventsTool`
  - `recommendationAgent` — GPT-4o-mini, **no tools** — reasoning-only narrator that explains why top picks were chosen (output consumed by trace viewer)
  - `planningAgent` — GPT-4o-mini, **no tools** — receives top 3 ranked events + user constraints, generates structured JSON itinerary plan via LLM reasoning (time blocks, logistics, notes)
  - `executionAgent` — GPT-4o-mini, uses `executeBookingTool` + 11 browser tools (open, snapshot, click, fill, select, press, wait, screenshot, text, eval, close) via Actionbook SDK + CLI
- [x] **15+ Mastra Tools** (`src/mastra/tools/`) — All agent logic extracted into `createTool()` primitives with Zod input/output schemas
  - `parseIntentTool` — Maps PlanFormData → UserConstraints (no LLM needed)
  - `searchEventbriteTool` — **FULLY IMPLEMENTED**: Bright Data Direct API with per-event detail enrichment (time, price, availability via JSON-LD), Schema.org event type support (Event, SocialEvent, EducationEvent, BusinessEvent, etc.), sold-out filtering, URL deduplication, date range filtering, budget/category post-filters + demo fallback with 5 realistic SG events
  - `searchEventfindaTool` — **FULLY IMPLEMENTED**: EventFinda REST API v2 with HTTP Basic auth, category slug mapping (forward + reverse), `fetchWithRetry()` with exponential backoff (MAX_RETRIES=3, 1.1s base delay), date range/budget/category filtering, demo fallback with 5 realistic SG events
  - `deduplicateEventsTool` — **FULLY IMPLEMENTED**: Name similarity (Levenshtein ratio > 0.7) + exact URL matching for cross-source event deduplication
  - `rankEventsTool` — **FULLY IMPLEMENTED**: Deterministic multi-factor scoring engine — budget fit (30%), category match (25%), rating (20%), availability (15%), weather fit (10%). Hard-filters sold-out/excluded/over-budget events first, then scores remaining. Returns sorted `rankedEvents[]` with per-event `score` and `reasoning` string + `filterStats`.
  - `planItineraryTool` — **FULLY IMPLEMENTED**: Receives ranked events + user constraints, invokes `planningAgent.generate()` for LLM-powered itinerary composition (time blocking, travel logistics, per-item notes), validates and maps LLM JSON output to `Itinerary` domain objects, computes `totalCost` and `totalDuration`, generates `planMetadata` (itinerary name, vibe, cost/person, budget status). Includes `formatSGT()` for Singapore Time display.
  - `executeBookingTool` — **FULLY IMPLEMENTED**: Full Actionbook 7-step booking flow — searches action manuals for verified CSS selectors, opens booking URL, snapshots page for LLM analysis, fills forms (buyer name/email/phone + organizer custom fields by label matching), handles multi-step Eventbrite checkout (ticket selection → attendee form → organizer questions → confirmation), ticket quantity stepper for party size, stuck-page detection, confirmation number extraction (order # regex + success text patterns), screenshot capture. Handles edge cases: sold-out, waitlist, captcha, login walls, payment required, missing URLs. Plus 11 individual browser tools (`browserOpenTool`, `browserSnapshotTool`, `browserClickTool`, `browserFillTool`, `browserSelectTool`, `browserPressTool`, `browserWaitTool`, `browserScreenshotTool`, `browserTextTool`, `browserEvalTool`, `browserCloseTool`) for the execution agent's tool-call interface.
- [x] **Mastra Workflow** (`src/mastra/workflows/planning-pipeline.ts`) — **Full pipeline** with modular step files in `src/mastra/workflows/steps/`: Intent step (`intent.step.ts`) invokes `intentAgent.generate()` (GPT-4o-mini LLM enrichment with deterministic fallback) → `prepareDiscoveryInput` mapper → parallel discovery (`discovery.step.ts`: 2 sources: Eventbrite + EventFinda via direct tool calls for speed) → `mergeAndDeduplicateEvents` mapper (includes HallyuCon injection for guaranteed free RSVP event for demo booking flow) → `rankAndRecommend` mapper (`ranking.step.ts`: deterministic scoring via `rankEventsTool.execute!()` + LLM narrative reasoning via `recommendationAgent.generate()`) → `planItinerary` mapper (`planning.step.ts`: LLM itinerary composition via `planItineraryTool.execute!()`) → **approval gate** (`approval.step.ts`: pipeline pauses, emits `plan_approval` trace, awaits user decision via Promise through in-memory approval registry) → **execution** (`execution.step.ts`: sequential booking via `executeBookingTool` for each bookable item with real browser automation) → output. Comprehensive `[pipeline:*]` logging at every stage. Emits structured `TraceEvent`s at each pipeline phase (intent, discovery, recommendation, planning, approval, execution) via `emitTrace()` helper using `AsyncLocalStorage` for traceId threading. Workflow utilities in `src/mastra/workflows/utils/` include trace helpers (`emitTrace()`, `formatSGT()`, start-time Maps), step types, and constants (`TIME_OF_DAY_WINDOWS`, `DURATION_HOURS`, `MAX_GAP_MINUTES`).
- [x] **Mastra Entrypoint** (`src/mastra/index.ts`) — Registers all agents, tools, and workflows with the Mastra framework. Configures `Observability` (via `@mastra/observability`) with `SSETracingExporter` for automatic span instrumentation.
- [x] **Context Manager** (`src/context/context-manager.ts`) — Write-through cache over Acontext Sessions. In-memory Map for zero-latency reads; writes fire-and-forget to Acontext for persistence. Falls back to pure in-memory when `ACONTEXT_API_KEY` is unset.
- [x] **Frontend** (`ui/`) — React 19 + Vite + Tailwind + shadcn/ui + Framer Motion + @tanstack/react-query
  - Landing page with shader gradient (`UnifiedShaderGradient`), hero section, authenticated home view (`AuthenticatedHome`)
  - Auth flow (login/signup pages, AuthProvider with Supabase, token storage via `tokenStorage.ts`)
  - Onboarding wizard (3-step: name → travel style/budget → interests) — redirects to `/plan` post-onboarding
  - Dashboard page (hardcoded metrics + activity feed) with "Plan a Trip" CTA card → `/plan`
  - Events page (hardcoded event cards)
  - Itineraries page (`/itineraries` route) — fetches user itineraries from MongoDB via `GET /api/itineraries`, displays list with formatted dates/costs via `useItineraries` hook
  - Protected routes, theme toggle (dark/light)
  - Plan wizard page (`/plan` route) — 4-step guided wizard: Occasion → Budget/Pax → When/Where → Review & Go
  - Trace Viewer components (ActiveAgentBanner, agent-aware PipelineProgress, TraceViewer integration)
  - API client (`apiClient.ts`) pointing to `/api` with token auth via `tokenStorage.ts`
- [x] **Project config** — TypeScript strict mode, ESM, path aliases, ESLint
- [x] **Backend API server** (`src/api/`) — Express 5 server with CORS, health check, auth routes (login/signup/logout/onboarding/profile), workflow route (start + approval), traces SSE route, events route, itineraries route
- [x] **Supabase Auth** — Client-side auth via Supabase JS SDK, server-side JWT verification middleware
- [x] **Environment config** (`src/config.ts`) — Zod-validated env loading with dotenv

### NOT Built (Must Implement)
- [x] **LLM Integration** — Intent Agent wired to OpenAI GPT-4o-mini via `@ai-sdk/openai` model provider through Mastra Agent
- [x] **Eventbrite Scraping** — `searchEventbriteTool` fully implemented with Bright Data Direct API (`POST /request`), HTML parsing (`window.__SERVER_DATA__` + JSON-LD), per-event detail page enrichment for accurate times/prices, Schema.org event type support (Event, SocialEvent, EducationEvent, BusinessEvent, etc.), sold-out filtering, category inference, event mapping. Falls back to 5 demo events when API key is missing or on failure.
- [x] **EventFinda Integration** — `searchEventfindaTool` fully implemented with EventFinda REST API v2, HTTP Basic auth, category slug mapping, retry with exponential backoff, date/budget/category filters. Falls back to 5 demo events when credentials are missing or on failure.
- [x] **Browser Automation** — Execution Agent fully wired with Actionbook SDK (action manual search) + CLI (Chrome browser control). `executeBookingTool` implements full 7-step booking flow: manual search → browser open → page snapshot → form fill (CSS selectors + label matching for custom fields) → multi-step checkout → confirmation capture → browser close. 11 individual browser tools registered for agent tool-call interface. Pipeline execution step runs sequentially for each bookable itinerary item post-approval. HallyuCon (free Eventbrite RSVP) injected as guaranteed bookable event for demo.
- [x] **Tracing System** — Full real-time trace system: `TraceEventBus` (pub/sub with history replay, 10min TTL auto-GC), `SSETracingExporter` (implements Mastra `ObservabilityExporter`, maps spans to structured `TraceEvent`s with reasoning/confidence/tokenUsage/reasoningSteps/decisions metadata), `AsyncLocalStorage`-based trace context for threading traceId through workflow steps. TraceEvent types are shared via `shared/types/trace.ts` (single source of truth). Two event sources: custom narrative events (human-readable, from pipeline) + Mastra auto-instrumented spans (technical, from exporter). Schema includes `ReasoningStep` (label/detail/status) and `Decision` (title/reason/score/data) interfaces for structured explainability.
- [x] **Backend API Routes** — Workflow POST route done (async, returns `workflowId` immediately); SSE trace streaming route done (`GET /api/traces/stream/:workflowId`); approval endpoint done (`POST /api/workflow/:id/approve` — persists itinerary to MongoDB on approval); events API done (`GET /api/events` with in-memory caching + live discovery tool calls, `GET /api/events/:id`); itineraries API done (`GET /api/itineraries` — reads from MongoDB)
- [x] **Database** — **Dual database architecture**: Supabase (Postgres) for auth/profiles + event schema (with RLS, 5 migrations, seed data) AND MongoDB (via Mongoose) for itinerary persistence. `profiles` table in Supabase (auth/onboarding). `events` table in Supabase (scraped event cache with RLS public read). Itineraries persisted to MongoDB `ItineraryModel` on plan approval via `persistItinerary()` utility (`src/api/persist-itinerary.ts`). MongoDB models in `src/mongodb/models/`. Legacy Supabase `itinerary` + `itinerary_items` table migrations exist in `supabase/migrations/` but active persistence uses MongoDB.
- [x] **Trace Viewer UI** — Full trace viewer with Tier 2 "WOW factor": `TraceViewer` (hierarchical span tree via `parentId` with `buildTree()`/`renderTree()`, auto-scroll to latest, inline approval card display), `ActiveAgentBanner` (animated banner showing current active agent), `PipelineProgress` (5-step horizontal stepper with agent names, glow animations, and Radix tooltip summaries), `SpanCard` (type-colored border, status badge, depth-based indentation, collapsible children with AnimatePresence, expandable metadata), `ReasoningBubble` (chat-bubble with `StreamingText` word-by-word animation), `StreamingText` (requestAnimationFrame-based word reveal at configurable WPS, blinking cursor, `onComplete` callback), `StructuredReasoning` (animated bullet-point reasoning steps with pass/fail/info status icons), `DecisionCard` + `DecisionList` (inline event cards with animated score bars, expandable raw data), `PlanApprovalCard` (itinerary summary with chronological timeline, approve/reject actions). SSE hook (`useTraceStream`) with EventSource, dedup, connection status tracking. Integrated into PlanPage wizard flow.
- [x] **Itinerary Display UI** — `ItinerariesPage` fetches from `GET /api/itineraries` via `useItineraries` hook, displays itinerary list with formatted dates, costs, and item counts. No detailed timeline view yet.
- [ ] **Agent Status Dashboard UI** — Partially addressed: `ActiveAgentBanner` shows real-time active agent identity during pipeline execution
- [x] **Real-time Trace Streaming** — SSE (Server-Sent Events) via Express route + native EventSource on frontend. Chose SSE over WebSocket: one-directional data flow, simpler, native browser support, auto-reconnect.
- [x] **Event Caching** — Supabase `events` table with seed data (15 SG events) + `GET /api/events` endpoint with pagination, category/availability/date filtering
- [x] **Discovery Tool Tests** — CLI test scripts for Eventbrite (`src/test-scraper.ts`) and EventFinda (`src/test-eventfinda.ts`) with 5 test modes each (all, dining, budget, concert, week)
- [ ] **Unit/Integration Tests** — No Vitest test framework or automated test suite

---

## Architecture

### Agent Pipeline (Mastra Workflow)
```
USER INPUT (PlanFormData)
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 1 — INTENT UNDERSTANDING                    ✅ WIRED  │
│                                                             │
│ HOW:  intentAgent.generate(prompt)  (GPT-4o-mini LLM call) │
│ WHY:  Natural language is ambiguous — the LLM enriches raw  │
│       form data with inferred categories, weather           │
│       sensitivity, and a confidence score. Deterministic     │
│       mapPlanFormToConstraints() runs as fallback.           │
│ TOOL: parseIntentTool (registered on agent, used as         │
│       fallback — agent.generate() is primary path)           │
│ OUT:  UserConstraints + intentSummary + agentReasoning       │
│ TRACE: intent_started → intent_completed                    │
└─────────────────────────────────────────────────────────────┘
   │
   ▼  .map() — extract date/budget/categories/areas for discovery
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2 — EVENT DISCOVERY (parallel)               ✅ WIRED  │
│                                                             │
│ HOW:  .parallel([searchEventbriteStep, searchEventfindaStep])│
│       Both tools invoked as Mastra steps (direct execution) │
│ WHY:  Two data sources run in parallel for speed. Tools are │
│       called directly (not via agent.generate()) because    │
│       scraping is deterministic — no LLM reasoning needed.  │
│ TOOLS: searchEventbriteTool (Bright Data Direct API)        │
│        searchEventfindaTool (EventFinda REST API v2)        │
│ MERGE: .map() combines results + deduplicateEventsTool      │
│ OUT:  Event[] + dedupStats + threaded constraints            │
│ TRACE: discovery_started → discovery_completed              │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3 — RANKING + RECOMMENDATION (hybrid)        ✅ WIRED  │
│                                                             │
│ HOW:  Two-phase approach in a single .map() callback:       │
│       1. rankEventsTool.execute!() — deterministic scoring  │
│       2. recommendationAgent.generate() — LLM narrative     │
│ WHY:  Scoring must be deterministic and reproducible (tool),│
│       but users need human-readable explanations of *why*   │
│       events were chosen (agent). Hybrid = best of both.    │
│ TOOL: rankEventsTool — multi-factor scoring engine:         │
│       budget fit 30%, category match 25%, rating 20%,       │
│       availability 15%, weather fit 10%                     │
│       Hard-filters sold-out/excluded/over-budget first.     │
│ AGENT: recommendationAgent (GPT-4o-mini, NO tools) —        │
│        receives top 3 ranked events + user context,         │
│        outputs JSON: { narrative, topPickReasoning,          │
│        tradeoffs, confidence }                              │
│        Falls back gracefully if agent/parse fails.          │
│ OUT:  rankedEvents (top 3) + recommendationNarrative         │
│ TRACE: ranking_started → ranking_completed (with agent      │
│        narrative, per-event reasoning, trade-offs)           │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4 — ITINERARY PLANNING                       ✅ WIRED  │
│                                                             │
│ HOW:  planItineraryTool.execute!() invokes                  │
│       planningAgent.generate() with structured prompt       │
│ WHY:  Time blocking, logistics, and cost estimation need    │
│       LLM reasoning to compose a coherent multi-event plan  │
│       from ranked events + user constraints.                │
│ TOOL: planItineraryTool — orchestrates LLM plan generation: │
│       builds structured prompt → planningAgent.generate()   │
│       → parses JSON → maps to Itinerary domain objects      │
│       → computes totalCost, totalDuration, planMetadata     │
│       (itinerary name, vibe, cost/person, budget status)    │
│ AGENT: planningAgent (GPT-4o-mini, NO tools) —              │
│        receives ranked events + constraints + occasion,     │
│        outputs structured JSON itinerary with time blocks,  │
│        travel logistics, per-item notes, and metadata.      │
│ OUT:  Itinerary + planMetadata                              │
│ TRACE: planning_started → planning_completed               │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4.5 — PLAN APPROVAL GATE                    ✅ WIRED  │
│                                                             │
│ HOW:  Pipeline emits plan_approval trace event with         │
│       status: 'awaiting_approval' and full itinerary data,  │
│       then calls waitForApproval(traceId) which returns a   │
│       Promise. Pipeline PAUSES until user POSTs decision    │
│       to POST /api/workflow/:id/approve.                    │
│ WHY:  Users must review and approve the AI-generated plan   │
│       before any execution actions are taken. This is the   │
│       human-in-the-loop control point.                      │
│ BACKEND: approvalRegistry (in-memory Map<workflowId,       │
│          {resolve, createdAt}>) with 30min TTL auto-GC.     │
│ FRONTEND: TraceViewer detects plan_approval event →         │
│           replaces trace tree with PlanApprovalCard →       │
│           user clicks Approve/Reject → POST to API →        │
│           resolves pipeline Promise → continues/stops.      │
│ OUT:  approved: boolean (pipeline continues or returns)     │
│ TRACE: plan_approval (awaiting) → plan_approval (approved   │
│        or rejected)                                         │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5 — EXECUTION                                ✅ WIRED │
│                                                             │
│ HOW:  Pipeline iterates bookableItems sequentially,         │
│       calling executeBookingTool.execute!() directly        │
│       (not via agent — faster, more deterministic).         │
│ WHY:  Booking is a multi-step browser flow that needs       │
│       deterministic CSS selector matching + form filling,   │
│       not LLM reasoning. Direct tool execution avoids       │
│       hallucinated selectors and is more reliable.          │
│ TOOL: executeBookingTool — Actionbook 7-step flow:          │
│       1. Search action manuals (SDK) for verified selectors │
│       2. Get detailed manual with CSS selectors             │
│       3. Open booking URL in Actionbook browser (CLI)       │
│       4. Snapshot page for structure analysis               │
│       5. Fill forms (CSS selectors + label matching) +      │
│          multi-step checkout (up to 6 steps) with           │
│          stuck-page detection                               │
│       6. Capture confirmation screenshot + extract order #  │
│       7. Close browser                                      │
│ INJECT: HallyuCon (free Eventbrite RSVP) is injected into   │
│         discovery results to guarantee at least one bookable │
│         free event for the demo — avoids hitting paywalls.   │
│ AGENT: executionAgent (GPT-4o-mini + 12 browser tools) —    │
│        available for agent-driven booking if needed, but     │
│        pipeline calls executeBookingTool directly for speed. │
│ GATE:  Only runs if Step 4.5 approval = true                │
│ OUT:   bookingResults[] (per-item status, confirmation #,   │
│         screenshot path, error details)                      │
│ TRACE: booking_execution (started → progress → completed)   │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
OUTPUT: { itinerary, rankedEvents (top 3), intentSummary,
          agentReasoning, filterStats, dedupStats,
          recommendationNarrative, planMetadata,
          bookingResults }

═══════════════════════════════════════════════════════════════
CROSS-CUTTING CONCERNS
═══════════════════════════════════════════════════════════════
TRACING     — emitTrace() at each phase → TraceEventBus → SSE → TraceViewer
OBSERVABILITY — SSETracingExporter auto-instruments Mastra spans
CONTEXT     — Write-through cache: in-memory Map + Acontext Sessions for durable persistence
AUTH        — Supabase JWT verification on API routes
```

### Tech Stack

| Layer | Tool | Status |
|-------|------|--------|
| **Frontend** | React 19 + Vite + Tailwind + shadcn/ui + Framer Motion | Scaffold done |
| **Backend API** | Express server | Auth routes + workflow route done |
| **Database** | Supabase (profiles + events) + MongoDB (itineraries via Mongoose) | DONE — dual DB: Supabase for auth/profiles/events with RLS + MongoDB for itinerary persistence |
| **LLM** | OpenAI GPT-4o-mini (via `@ai-sdk/openai` + Mastra Agent) | Intent + Recommendation + Planning Agents wired |
| **Data Acquisition** | Bright Data Direct API + EventFinda REST API v2 | Eventbrite DONE, EventFinda DONE |
| **Browser Automation** | Actionbook SDK (`@actionbookdev/sdk`) + CLI (`@actionbookdev/cli`) | DONE — full 7-step booking flow wired into pipeline |
| **Context/Memory** | Acontext (shared state, workflow tracking) | DONE — write-through cache (in-memory + Acontext Sessions) |
| **Orchestration** | Mastra Workflow (`@mastra/core`) | DONE — full pipeline wired |
| **Tracing** | Custom (TraceEventBus + SSETracingExporter + SSE streaming) | DONE — Tier 1 + Tier 2 (WOW factor) complete |
| **Auth** | Supabase (client-side SDK + server JWT verification) | Done |
| **Validation** | Zod | Done |

### File Structure
```
shared/
├── types/
│   └── trace.ts              # Single source of truth for TraceEvent types (backend + frontend)

src/
├── mastra/
│   ├── index.ts                 # Mastra entrypoint — registers agents, tools, workflows + Observability (SSETracingExporter)
│   ├── agents/
│   │   ├── index.ts             # Barrel export
│   │   ├── prompts.ts           # Legacy barrel — re-exports from prompts/
│   │   ├── prompts/             # Individual agent system prompts
│   │   │   ├── index.ts           # Barrel export for all prompts
│   │   │   ├── intent.prompt.ts   # Intent agent system prompt
│   │   │   ├── discovery.prompt.ts # Discovery agent system prompt
│   │   │   ├── recommendation.prompt.ts # Recommendation agent system prompt
│   │   │   ├── planning.prompt.ts # Planning agent system prompt
│   │   │   └── execution.prompt.ts # Execution agent system prompt
│   │   ├── intent.ts            # intentAgent — GPT-4o-mini + parseIntentTool
│   │   ├── discovery.ts         # discoveryAgent — GPT-4o-mini + search tools
│   │   ├── recommendation.ts    # recommendationAgent — GPT-4o-mini, NO tools — reasoning-only narrator for traces
│   │   ├── planning.ts          # planningAgent — GPT-4o-mini, NO tools — receives ranked events + constraints, generates structured JSON itinerary
│   │   └── execution.ts         # executionAgent — GPT-4o-mini + executeBookingTool + 11 browser tools (Actionbook SDK + CLI)
│   ├── tools/
│   │   ├── index.ts             # Barrel export
│   │   ├── parse-intent.ts      # Maps PlanFormData → UserConstraints
│   │   ├── search-eventbrite.ts # DONE: Bright Data Direct API + per-event enrichment + sold-out filtering
│   │   ├── search-eventfinda.ts # DONE: EventFinda REST API v2 + retry + category mapping
│   │   ├── utils/
│   │   │   └── category.ts     # Shared category inference (word-boundary regex, CATEGORY_KEYWORDS, slug maps)
│   │   ├── deduplicate-events.ts # DONE: Name similarity (Levenshtein ratio > 0.7) + exact URL matching for cross-source dedup
│   │   ├── rank-events.ts       # DONE: Deterministic multi-factor scoring (budget 30%, category 25%, rating 20%, availability 15%, weather 10%)
│   │   ├── plan-itinerary.ts    # DONE: LLM-powered itinerary composition via planningAgent + structured prompt → JSON → domain objects
│   │   └── execute-booking.ts   # DONE: Full Actionbook 7-step booking flow + 11 individual browser tools
│   └── workflows/
│       ├── planning-pipeline.ts # Full pipeline: intent (LLM) → parallel discovery → HallyuCon injection → merge + dedup → ranking (tool) + recommendation (LLM) → planning (LLM) → approval gate → execution (Actionbook booking) → output
│       ├── steps/               # Modular step implementations
│       │   ├── intent.step.ts     # Intent understanding + LLM enrichment via intentAgent.generate()
│       │   ├── discovery.step.ts  # prepareDiscoveryInput() + mergeAndDeduplicateEvents() (includes HallyuCon injection for demo)
│       │   ├── ranking.step.ts    # rankAndRecommend() deterministic scoring + LLM narrative
│       │   ├── planning.step.ts   # planItinerary() LLM plan generation + tool validation
│       │   ├── approval.step.ts   # awaitApproval() human-in-the-loop gate via approval registry
│       │   └── execution.step.ts  # executeBookings() sequential Actionbook booking for each approved item
│       └── utils/               # Workflow utilities
│           ├── trace-helpers.ts # emitTrace(), formatSGT(), start-time Maps
│           ├── types.ts         # Workflow step types
│           └── constants.ts     # TIME_OF_DAY_WINDOWS, DURATION_HOURS, MAX_GAP_MINUTES
├── config.ts                    # Zod-validated env config (dotenv) — DONE (includes BRIGHT_DATA_API_KEY)
├── lib/
│   ├── supabase.ts             # DEPRECATED — use supabase/supabase.ts instead
│   └── actionbook.ts           # Actionbook integration layer: SDK (action manual search) + CLI (Chrome browser control via child_process)
├── context/
│   ├── index.ts
│   └── context-manager.ts       # Write-through cache: in-memory Map + Acontext Sessions — DONE
├── tracing/                     # DONE — real-time trace system
│   ├── sse-exporter.ts          # Re-exports types from @shared/types/trace.js + TraceEventBus singleton
│   ├── mastra-sse-exporter.ts   # SSETracingExporter (Mastra ObservabilityExporter → TraceEvent mapping)
│   ├── trace-context.ts         # AsyncLocalStorage<string> for threading traceId through workflow steps
│   └── index.ts                 # Barrel exports (traceEventBus, SSETracingExporter, traceContext)
├── api/
│   ├── server.ts                # Express server — DONE (health + auth + workflow + traces + events + itineraries routes)
│   ├── approval-registry.ts     # In-memory approval gate registry (waitForApproval/resolveApproval) with 30min TTL — DONE
│   ├── persist-itinerary.ts     # Maps domain Itinerary → MongoDB document via ItineraryModel on approval — DONE
│   ├── middleware/
│   │   └── auth.ts              # Supabase JWT verification middleware — DONE
│   └── routes/
│       ├── auth.ts              # POST /api/auth/login, POST /api/auth/signup, POST /api/auth/logout, POST /api/auth/onboarding, GET /api/auth/profile — DONE
│       ├── workflow.ts           # POST /api/workflow + POST /api/workflow/:id/approve — DONE (async pipeline + approval gate)
│       ├── traces.ts             # GET /api/traces/stream/:workflowId — DONE (SSE endpoint with history replay, heartbeat, auto-close)
│       ├── events.ts             # GET /api/events (paginated, filtered) + GET /api/events/:id — DONE
│       └── itineraries.ts        # GET /api/itineraries — DONE (reads from MongoDB)
├── types/
│   └── index.ts                 # Zod schemas + PlanFormData + mapPlanFormToConstraints — DONE
├── index.ts                     # Main exports (re-exports from mastra/) — DONE
├── test-scraper.ts              # CLI test runner for searchEventbriteTool (npx tsx src/test-scraper.ts <test>)
└── test-eventfinda.ts           # CLI test runner for searchEventfindaTool (npx tsx src/test-eventfinda.ts <test>)
├── mongodb/
│   ├── index.ts                 # connectMongo() via Mongoose — DONE
│   └── models/
│       ├── Itinerary.ts         # Full Mongoose schema (IEventSnapshot, IItineraryItem, IItinerary) indexed on createdBy — DONE
│       └── Event.ts             # Stubbed/commented out (not yet implemented)

supabase/
├── config.toml                  # Supabase local dev config (project ID, API ports, auth settings)
├── supabase.ts                  # Server-side Supabase clients (supabaseAdmin + createSupabaseClient) — DONE
├── seed.sql                     # Seed data: 15 SG events + 2 itineraries + 4 itinerary_items
└── migrations/
    ├── 20260226071416_create_profiles_table.sql    # profiles table + RLS
    ├── 20260226135200_create_events_table.sql      # events table (category, price, availability, location JSONB)
    ├── 20260226135300_create_itinerary_tables.sql   # itinerary + itinerary_items tables
    ├── 20260226135400_add_rls_events_table.sql     # events RLS: public read, service-role write
    └── 20260226135500_add_rls_itinerary_tables.sql # itinerary RLS: user-scoped CRUD, items inherit via parent

ui/
├── src/
│   ├── components/
│   │   ├── auth/ProtectedRoute.tsx    # DONE
│   │   ├── home/HeroSection.tsx       # DONE
│   │   ├── home/UnifiedShaderGradient.tsx # DONE
│   │   ├── home/AuthenticatedHome.tsx # DONE (authenticated landing view with CTA)
│   │   ├── layout/                    # DONE (Header, Footer, Layout, PageHeader, AppRoutes)
│   │   ├── theme/                     # DONE (ThemeToggle, ThemeProvider)
│   │   ├── trace/
│   │   │   ├── TraceViewer.tsx         # DONE (hierarchical span tree, auto-scroll, inline plan approval card)
│   │   │   ├── PipelineProgress.tsx    # DONE (5-step horizontal stepper with agent names, glow animations, and Radix tooltip summaries)
│   │   │   ├── ActiveAgentBanner.tsx   # DONE (animated banner showing current active agent name with crossfade transitions)
│   │   │   ├── SpanCard.tsx            # DONE (type-colored border, status badge, depth-based indentation, collapsible children)
│   │   │   ├── ReasoningBubble.tsx     # DONE (chat-bubble with StreamingText word-by-word animation)
│   │   │   ├── StreamingText.tsx       # DONE (requestAnimationFrame-based word reveal at configurable WPS, blinking cursor)
│   │   │   ├── StructuredReasoning.tsx # DONE (animated bullet-point reasoning steps with pass/fail/info status icons)
│   │   │   ├── DecisionCard.tsx        # DONE (inline event cards with animated score bars, expandable raw data, DecisionList)
│   │   │   └── PlanApprovalCard.tsx    # DONE (itinerary summary with chronological timeline, approve/reject actions, animated entry)
│   │   └── ui/                        # DONE (shadcn components)
│   ├── hooks/
│   │   ├── useAuth.tsx                # DONE (Supabase auth)
│   │   ├── use-toast.ts              # DONE
│   │   ├── use-mobile.tsx            # DONE
│   │   ├── useTraceStream.ts         # DONE (EventSource SSE hook with dedup + connection status)
│   │   ├── useWorkflow.ts            # NEEDS: workflow state management
│   │   └── useItineraries.ts         # DONE (fetches from /api/itineraries, format helpers)
│   ├── lib/
│   │   ├── apiClient.ts              # DONE (Supabase token auth)
│   │   ├── supabase.ts              # DONE (frontend Supabase client)
│   │   ├── tokenStorage.ts           # DONE (localStorage token get/set/remove helpers)
│   │   └── utils.ts                  # DONE
│   └── pages/
│       ├── Index.tsx                  # DONE
│       ├── LoginPage.tsx              # DONE
│       ├── SignupPage.tsx             # DONE
│       ├── OnboardingPage.tsx         # DONE
│       ├── DashboardPage.tsx          # DONE (hardcoded metrics, "Plan a Trip" CTA card → /plan)
│       ├── PlanPage.tsx               # DONE (4-step wizard + TraceViewer integration: submits → shows real-time traces)
│       ├── EventsPage.tsx             # DONE (hardcoded, needs real data)
│       ├── AboutPage.tsx              # DONE
│       └── NotFound.tsx               # DONE
│       └── ItinerariesPage.tsx       # DONE (fetches user itineraries from MongoDB via useItineraries hook)
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## Dependencies

### Backend (`package.json`) — Currently Installed
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@mastra/core` | ^1.6.0 | Agent orchestration framework | Installed, actively used |
| `@ai-sdk/openai` | ^3.0.31 | OpenAI model provider for Mastra | Installed, actively used |
| `zod` | ^3.22.0 | Schema validation | Installed, actively used |
| `express` | ^5.1.0 | HTTP server | Installed, actively used |
| `cors` | ^2.8.5 | CORS middleware | Installed, actively used |
| `dotenv` | ^16.5.0 | Environment variable loading | Installed, actively used |
| `@supabase/supabase-js` | ^2.49.8 | Supabase client (auth + DB) | Installed, actively used |
| `typescript` | ^5.3.0 | Type checking | Dev dep, working |
| `tsx` | ^4.0.0 | TS execution | Dev dep, working |
| `eslint` | ^8.0.0 | Linting | Dev dep |
| `@types/express` | ^5.0.2 | Express type definitions | Dev dep |
| `@types/cors` | ^2.8.19 | CORS type definitions | Dev dep |
| `@actionbookdev/sdk` | | Actionbook SDK — action manual search for verified CSS selectors | Installed, actively used |
| `@actionbookdev/cli` | | Actionbook CLI — Chrome browser control (open, click, fill, snapshot, etc.) | Installed, actively used |
| `mongoose` | ^8.13.2 | MongoDB ODM for itinerary persistence | Installed, actively used |
| `@mastra/observability` | | Mastra observability (SSETracingExporter) | Installed, actively used |
| `@acontext/acontext` | | Acontext SDK for durable workflow state persistence | Installed, actively used |

### Backend — Needs to be Added
| Package | Purpose | Owner |
|---------|---------|-------|
| (none currently) | All required packages are installed | — |

### Frontend (`ui/package.json`) — Currently Installed
| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `react` | ^19.2.0 | UI framework | Working |
| `react-router-dom` | ^7.13.0 | Client-side routing | Working |
| `react-hook-form` + `@hookform/resolvers` | Form handling | Working |
| `@radix-ui/*` | Accessible UI primitives | Working |
| `@react-three/fiber` + `three` + `@shadergradient/react` | 3D shader gradient on landing | Working |
| `framer-motion` | Animations | Working |
| `lucide-react` | Icons | Working |
| `tailwind-merge` + `class-variance-authority` + `clsx` | Styling utilities | Working |
| `date-fns` | Date formatting | Working |
| `sonner` | Toast notifications | Working |
| `zod` | ^4.3.6 | Frontend validation | Working |
| `@supabase/supabase-js` | ^2.49.8 | Supabase auth client | Working |
| `@tanstack/react-query` | ^5.x | Server state management, caching | Working |

### Frontend — Needs to be Added
| Package | Purpose | Owner |
|---------|---------|-------|
| (none currently) | All required packages are installed | — |

---

## Team Work Split

### Jeremy — Agent Network / Tools + Infrastructure
**Focus**: Server infrastructure, database, agent tool integrations, orchestration wiring

| Priority | Task | Files | Status |
|----------|------|-------|--------|
| ~~P0~~ | ~~Set up Express/Hono backend server~~ | `src/api/server.ts` | ✅ DONE |
| ~~P0~~ | ~~Create API routes for workflow~~ | `src/api/routes/workflow.ts` | ✅ DONE (POST /api/workflow — validates PlanFormData, runs full Mastra pipeline, returns events + intent) |
| ~~P0~~ | ~~SSE server for trace streaming~~ | `src/api/routes/traces.ts` | ✅ DONE (SSE endpoint with history replay, heartbeat, auto-close on pipeline completion) |
| ~~P0~~ | ~~Build tracing system (EventBus, Exporter, Context)~~ | `src/tracing/*` | ✅ DONE (TraceEventBus, SSETracingExporter, AsyncLocalStorage trace context) |
| ~~P0~~ | ~~Add trace hooks to Mastra Workflow~~ | `src/mastra/workflows/planning-pipeline.ts` | ✅ DONE (emitTrace() at intent + discovery phases, Observability config in Mastra entrypoint) |
| ~~P1~~ | ~~Database setup (SQLite/Postgres) for persistence~~ | `supabase/migrations/*` | ✅ DONE (Supabase: profiles + events + itinerary tables, RLS, migrations, seed data) |
| ~~P1~~ | ~~Acontext integration for shared memory~~ | `src/context/context-manager.ts` | ✅ DONE (write-through cache: in-memory + Acontext Sessions) |
| ~~P1~~ | ~~Environment config / dotenv setup~~ | `src/config.ts` | ✅ DONE |
| P2 | Error handling + recovery in workflow | `src/mastra/workflows/planning-pipeline.ts` | NOT STARTED |

### Jared — Agent Network, Web Scraping & Browser Automation
**Focus**: Discovery Agent scraping, Execution Agent browser actions, data acquisition

| Priority | Task | Files | Status |
|----------|------|-------|--------|
| ~~P0~~ | ~~Wire Intent Agent to OpenAI~~ | `src/mastra/agents/intent.ts` | ✅ DONE (GPT-4o-mini via `@ai-sdk/openai` + Mastra Agent) |
| ~~P0~~ | ~~Implement Bright Data scraping for Eventbrite~~ | `src/mastra/tools/search-eventbrite.ts` | ✅ DONE (Bright Data Direct API + demo fallback) |
| ~~P0~~ | ~~Implement EventFinda REST API integration~~ | `src/mastra/tools/search-eventfinda.ts` | ✅ DONE (EventFinda REST API v2 + retry + category mapping) |
| ~~P0~~ | ~~Shared category inference utility~~ | `src/mastra/tools/utils/category.ts` | ✅ DONE (word-boundary regex, CATEGORY_KEYWORDS, slug maps) |
| ~~P0~~ | ~~Implement Execution Agent with Actionbook~~ | `src/mastra/agents/execution.ts`, `src/mastra/tools/execute-booking.ts`, `src/lib/actionbook.ts` | ✅ DONE (Actionbook SDK + CLI, full 7-step booking flow, 11 browser tools, HallyuCon injection for demo) |
| ~~P1~~ | ~~Add tracing events to all agent methods~~ | `src/mastra/workflows/planning-pipeline.ts` | ✅ DONE (emitTrace() at every pipeline phase including execution) |
| ~~P1~~ | ~~Real-time availability checking~~ | ~~`src/mastra/tools/check-availability.ts`~~ | REMOVED (no longer needed) |
| P1 | Create mock/cached event data fallback | `src/data/mock-events.ts` | NOT STARTED |
| ~~P1~~ | ~~Discovery tool test scripts~~ | `src/test-scraper.ts`, `src/test-eventfinda.ts` | ✅ DONE (5 test modes each) |

### Shawn — Backend: Events API, Recommendations, Integrations
**Focus**: Event caching layer, recommendation engine API, external API integrations

| Priority | Task | Files | Status |
|----------|------|-------|--------|
| ~~P0~~ | ~~Events API endpoint (cached events for frontend)~~ | `src/api/routes/events.ts` | ✅ DONE (GET /api/events with pagination + category/availability/date filtering, GET /api/events/:id) |
| ~~P0~~ | ~~Event caching/storage system~~ | `supabase/seed.sql`, `supabase/migrations/*` | ✅ DONE (Supabase events table + 15 seed events) |
| P0 | Recommendation API endpoint | `src/api/routes/recommendations.ts` | NOT STARTED |
| P1 | Google Maps Distance Matrix integration | `src/mastra/tools/plan-itinerary.ts` | NOT STARTED |
| P1 | Weather API integration | `src/services/weather.ts` | NOT STARTED |
| ~~P1~~ | ~~Wire Recommendation Agent scoring with real data~~ | `src/mastra/tools/rank-events.ts` | ✅ DONE (deterministic multi-factor scoring engine, wired into pipeline) |
| ~~P2~~ | ~~Event deduplication improvement~~ | `src/mastra/tools/deduplicate-events.ts` | ✅ DONE (Levenshtein name similarity + exact URL matching) |
| P2 | Price tracking / comparison service | `src/services/pricing.ts` | NOT STARTED |

### Xinyu — Backend + Frontend (Validation, State Management, Auth)
**Focus**: Auth backend, frontend state management, form validation, connecting UI to APIs

| Priority | Task | Files | Status |
|----------|------|-------|--------|
| ~~P0~~ | ~~Auth backend endpoints (login/signup/logout)~~ | `src/api/routes/auth.ts` | ✅ DONE (Supabase — no login/signup backend routes needed) |
| ~~P0~~ | ~~JWT token signing/verification middleware~~ | `src/api/middleware/auth.ts` | ✅ DONE (Supabase JWT verification) |
| ~~P0~~ | ~~Connect frontend auth to real backend~~ | `ui/src/hooks/useAuth.tsx` | ✅ DONE (Supabase client-side auth) |
| P0 | Dashboard page with real data | `ui/src/pages/DashboardPage.tsx` | Hardcoded UI done |
| P0 | Events page with real API data | `ui/src/pages/EventsPage.tsx` | Hardcoded UI done |
| ~~P1~~ | ~~Trace Viewer component~~ | `ui/src/components/trace/TraceViewer.tsx` + `PipelineProgress.tsx` + `SpanCard.tsx` + `ReasoningBubble.tsx` | ✅ DONE (full trace viewer with pipeline stepper, span cards, reasoning bubbles) |
| P1 | Itinerary Timeline display | `ui/src/components/ItineraryTimeline.tsx` | NOT STARTED |
| ~~P1~~ | ~~SSE hook for trace streaming~~ | `ui/src/hooks/useTraceStream.ts` | ✅ DONE (EventSource SSE hook with dedup + connection status) |
| P1 | Workflow submission + status hook | `ui/src/hooks/useWorkflow.ts` | NOT STARTED |
| ~~P1~~ | ~~Onboarding POST to real backend~~ | `ui/src/pages/OnboardingPage.tsx` | ✅ DONE (posts to /api/auth/onboarding) |
| P2 | Agent Status dashboard component | `ui/src/components/AgentStatus.tsx` | NOT STARTED |
| P2 | Form validation improvements | Various UI files | NOT STARTED |

### Carnegie — QC, Testing & Bug Fixing
**Focus**: End-to-end testing, integration testing, bug fixes, demo reliability

| Priority | Task | Files | Status |
|----------|------|-------|--------|
| P0 | Set up test framework (Vitest) | `vitest.config.ts`, `package.json` | NOT STARTED |
| P0 | Test orchestrator pipeline end-to-end | `tests/orchestrator.test.ts` | NOT STARTED |
| P0 | Test each agent individually | `tests/agents/*.test.ts` | NOT STARTED |
| P1 | Test API endpoints | `tests/api/*.test.ts` | NOT STARTED |
| P1 | Test trace system | `tests/tracing/*.test.ts` | NOT STARTED |
| P1 | Integration test: full flow with mock data | `tests/integration/*.test.ts` | NOT STARTED |
| P1 | Bug fixes from other team members | Various | Ongoing |
| P2 | Error handling edge cases | Various | NOT STARTED |
| P2 | Demo rehearsal + reliability testing | Manual | NOT STARTED |
| P2 | Create mock data fallback suite | `src/data/mock-*.ts` | NOT STARTED |

---

## Data Sources (Scraping Targets)

### Singapore Events (Primary)
| Source | What | Scraping Method |
|--------|------|-----------------|
| Eventbrite SG | Concerts, workshops, cultural events | Bright Data Direct API (web scraping) |
| EventFinda SG | Community events, festivals, activities | REST API v2 (HTTP Basic auth) |
| Peatix | Community events, tech events | Bright Data structured scraping |
| Meetup | Groups, community activities | Bright Data structured scraping |
| Google Places | Local businesses, ratings | Google Places API |

### Asia Events (Stretch)
| Region | Sources |
|--------|---------|
| Japan | Time Out Tokyo, Rakuten Travel, Eventbrite JP |
| Pan-Asia | Klook, Tripadvisor, Ticketmaster Asia |

### Logistics (Stretch)
| Type | Sources |
|------|---------|
| Flights | Skyscanner, Google Flights, Kayak |
| Hotels | Booking.com, Agoda, Airbnb |

---

## API Endpoints

| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| — | `/api/auth/login` | Handled client-side by Supabase SDK | ✅ N/A (client-side) |
| — | `/api/auth/signup` | Handled client-side by Supabase SDK | ✅ N/A (client-side) |
| — | `/api/auth/logout` | Handled client-side by Supabase SDK | ✅ N/A (client-side) |
| POST | `/api/auth/onboarding` | Save onboarding preferences to Supabase `profiles` | ✅ DONE |
| GET | `/api/auth/profile` | Get user profile (onboarding status) | ✅ DONE |
| GET | `/api/health` | Health check | ✅ DONE |
| GET | `/api/events` | Get events (paginated, filterable by category/availability/date) with in-memory caching + live discovery tool calls | ✅ DONE |
| GET | `/api/events/:id` | Get single event details | ✅ DONE |
| POST | `/api/workflow` | Start new planning workflow (async) | ✅ DONE (returns `{ workflowId }` immediately, pipeline runs in background with traceContext) |
| POST | `/api/workflow/:id/approve` | Approve/reject plan (approval gate) + persist itinerary to MongoDB on approval | ✅ DONE (resolves pipeline Promise, persists to MongoDB via `ItineraryModel`, accepts `{ approved: boolean }`) |
| GET | `/api/workflow/:id` | Get workflow status + result | NOT STARTED |
| GET | `/api/traces/stream/:workflowId` | Real-time SSE trace stream | ✅ DONE (history replay, 15s heartbeat, auto-close on completion) |
| GET | `/api/itineraries` | Get user’s itineraries (protected, reads from MongoDB) | ✅ DONE |
| GET | `/api/recommendations` | Get recommendations for query | NOT STARTED |

---

## Environment Variables

```bash
# === Backend (.env) ===

# Supabase (REQUIRED)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...                      # Public anon key
SUPABASE_SERVICE_ROLE_KEY=eyJ...               # Server-side only, NEVER expose to client

# Server
PORT=3000
NODE_ENV=development

# LLM (Intent Agent)
OPENAI_API_KEY=sk-...

# Bright Data (Discovery Agent — Direct API)
BRIGHT_DATA_API_KEY=              # Bearer token for api.brightdata.com/request
BRIGHT_DATA_ZONE=                 # Optional: zone override

# EventFinda (Discovery Agent — REST API v2)
EVENTFINDA_USERNAME=              # HTTP Basic auth username
EVENTFINDA_PASSWORD=              # HTTP Basic auth password

# Acontext (Shared Memory)
ACONTEXT_API_KEY=                # Acontext SDK for durable workflow state (optional — falls back to in-memory)

# ActionBook (Execution Agent)
ACTIONBOOK_API_KEY=

# MongoDB (Itinerary Persistence)
MONGO_URI=mongodb://localhost:27017/itinerary-planner  # MongoDB connection string

# Optional
GOOGLE_MAPS_API_KEY=             # Route optimization
WEATHER_API_KEY=                 # Weather-aware planning

# Demo mode
DEMO_MODE=true                   # Use cached data
TRACE_VERBOSE=true               # Extra trace detail

# === Frontend (ui/.env) ===
VITE_SUPABASE_URL=https://your-project.supabase.co   # Same as SUPABASE_URL
VITE_SUPABASE_ANON_KEY=eyJ...                        # Same as SUPABASE_ANON_KEY
```

### Supabase Setup Requirements

The backend uses **Supabase** (Postgres) for auth, profiles, and event caching, and **MongoDB** (via Mongoose) for itinerary persistence. Supabase schema is managed via 5 migrations in `supabase/migrations/`.

#### Tables

**`profiles`** — User auth/onboarding data (migration: `20260226071416`)
```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  travel_style text,
  budget_range text,
  interests jsonb default '[]'::jsonb,
  is_onboarded boolean default false,
  updated_at timestamptz default now()
);
-- RLS: users can read/write their own profile only
```

**`events`** — Scraped/cached event data (migration: `20260226135200`)
```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  source text,           -- 'eventbrite' | 'eventfinda'
  url text,
  image text,
  venue text,
  location jsonb,         -- { lat, lng, address }
  start_time timestamptz,
  end_time timestamptz,
  price_min numeric,
  price_max numeric,
  price_currency text default 'SGD',
  availability text default 'available',  -- 'available' | 'sold_out' | 'limited'
  rating numeric,
  tags text[] default '{}',
  raw_data jsonb,
  created_at timestamptz default now()
);
-- RLS: public read (anon + authenticated), service-role write
```

**`itinerary`** — User-approved itinerary plans (migration: `20260226135300`)
```sql
create table itinerary (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete cascade,
  summary text,
  total_cost_min numeric,
  total_cost_max numeric,
  total_cost_currency text default 'SGD',
  status text default 'draft',  -- 'draft' | 'approved' | 'booked'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- RLS: user-scoped CRUD (users can only access their own itineraries)
```

**`itinerary_items`** — Individual items within an itinerary (migration: `20260226135300`)
```sql
create table itinerary_items (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid references itinerary(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  event_snapshot jsonb,    -- Full event data at time of planning (denormalized)
  time_start timestamptz,
  time_end timestamptz,
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now()
);
-- RLS: inherits access from parent itinerary via subquery
```

#### RLS Policies
- **profiles**: User-scoped CRUD (`auth.uid() = id`)
- **events**: Public read for anon + authenticated; service-role only for insert/update/delete (migration: `20260226135400`)
- **itinerary**: User-scoped — SELECT/INSERT/UPDATE/DELETE all require `auth.uid() = created_by` (migration: `20260226135500`)
- **itinerary_items**: Inherits via parent — all operations require `itinerary_id IN (SELECT id FROM itinerary WHERE created_by = auth.uid())` (migration: `20260226135500`)

#### Seed Data (`supabase/seed.sql`)
- 15 Singapore events across dining, concerts, workshops, exhibitions, nightlife
- 2 sample itineraries with 4 itinerary_items total
- Auth user creation commented out (use Supabase dashboard instead)

#### Itinerary Persistence Flow

When a user approves a plan via `POST /api/workflow/:id/approve`:

1. Pipeline's approval gate resolves -> workflow continues
2. `persistItinerary(userId, itinerary)` is called (`src/api/persist-itinerary.ts`)
3. `computeCostRange()` derives `totalCost.{min,max}` from individual item event prices (falls back to `itinerary.totalCost` scalar if no items carry price data)
4. `ItineraryModel.create({...})` inserts a single MongoDB document with all items embedded as subdocuments
5. Each item's `event` field is serialized via `eventToSnapshot()` which flattens domain `Event` to the `IEventSnapshot` interface
6. Returns `{ itineraryId, itemCount }` on success; throws on MongoDB insert failure

**Schema mapping (domain → MongoDB):**

| Domain (`Itinerary`) | MongoDB (`itineraries` collection) | Notes |
|---|---|---|
| `name` | `summary` | Direct mapping |
| `date` | `plannedDate` | ISO 8601 date string (nullable) |
| (computed) | `totalCost.min` / `totalCost.max` | Sum of item event `price.min`/`price.max` via `computeCostRange()` |
| N/A | `totalCost.currency` | Hardcoded `'SGD'` |
| (from auth) | `createdBy` | `req.user.id` from JWT (Supabase UUID) — indexed for fast per-user queries |
| (auto) | `createdAt` / `updatedAt` | Mongoose `timestamps: true` |

| Domain (`ItineraryItem`) | MongoDB (embedded `items[]` array) | Notes |
|---|---|---|
| `event` (full object) | `items[].event` (IEventSnapshot) | Serialized via `eventToSnapshot()` — includes id, name, description, url, image, venue, location, startTime, endTime, price, category, tags, rating, availability, source |
| `scheduledTime.start` | `items[].time.start` | ISO timestamp string |
| `scheduledTime.end` | `items[].time.end` | ISO timestamp string |
| `notes` | `items[].notes` | Direct (nullable) |

**Note:** Legacy Supabase `itinerary` + `itinerary_items` table migrations exist in `supabase/migrations/` but active persistence uses MongoDB via Mongoose.
---

## Testing

### Discovery Tool Test Scripts

CLI test runners for verifying individual discovery tools against live APIs or demo fallback.

#### Eventbrite (`test-scraper.ts`)

```bash
# Show usage / available tests
npx tsx src/test-scraper.ts

# Run specific tests
npx tsx src/test-scraper.ts all       # All events (default +3 day range)
npx tsx src/test-scraper.ts dining    # Dining category only
npx tsx src/test-scraper.ts budget    # Budget max $50
npx tsx src/test-scraper.ts concert   # Concert/music category
npx tsx src/test-scraper.ts week      # 7-day date range
```

Requires `BRIGHT_DATA_API_KEY` (falls back to demo data if unset).

#### EventFinda (`test-eventfinda.ts`)

```bash
# Show usage / available tests
npx tsx src/test-eventfinda.ts

# Run specific tests
npx tsx src/test-eventfinda.ts all       # All events (default +3 day range)
npx tsx src/test-eventfinda.ts dining    # Dining category only
npx tsx src/test-eventfinda.ts budget    # Budget max $50
npx tsx src/test-eventfinda.ts concert   # Concert/music category
npx tsx src/test-eventfinda.ts week      # 7-day date range
```

Requires `EVENTFINDA_USERNAME` and `EVENTFINDA_PASSWORD` (falls back to demo data if unset).

#### Type Checking

```bash
npx tsc --noEmit    # Full project type check (zero errors expected)
```

### Test Log Prefixes

Each tool emits essential debug logs with consistent prefixes:
- `[eventbrite]` — Eventbrite tool: fetch URLs, raw/filtered event counts, enrichment progress, errors
- `[eventfinda]` — EventFinda tool: search params, fetch URLs, API result counts, retry warnings, errors
- `[pipeline:*]` — Workflow pipeline: agent invocations, per-source event counts, top events
- `[workflow]` — API route: request validation, pipeline execution
- `[trace:*]` — Trace system: SSE connections, event emission, exporter span mapping

---

## Demo Script (2 Minutes)

```
[0:00] INTRO
"We built an autonomous logistics agent that doesn't just plan — it executes.
And uniquely, it explains every decision it makes."

[0:15] INPUT
Type: "Plan a Saturday date under $150 in Singapore"

[0:20] TRACE VIEWER ACTIVATES — real-time agent spans appear

[0:25] INTENT AGENT — "Understood: romantic evening for two, budget $150 SGD"

[0:40] DISCOVERY AGENT — "Searching Eventbrite, EventFinda... 35 events found"

[0:55] RECOMMENDATION AGENT — "Scored and ranked. Top picks: high rating + fits budget"

[1:10] PLANNING AGENT — "Dinner 6pm → Show 8pm → Drinks 10pm. 2.3km total travel"

[1:25] EXECUTION AGENT — browser visibly navigates, fills forms, confirms booking

[1:45] FINAL OUTPUT — complete itinerary with booking confirmations

[2:00] CLOSE
"We didn't build a planner. We built an autonomous agent that takes action
and shows its work."
```

---

## Conventions & Patterns

### Code Style
- TypeScript strict mode, ESM modules
- Zod for all data validation
- Mastra `Agent` with `@ai-sdk/openai` model provider for LLM-powered agents
- Mastra `createTool()` with Zod input/output schemas for all agent logic
- Mastra `Workflow` for pipeline orchestration
- Context Manager is the single source of workflow state

### Naming
- Agents: `xxxAgent` — Mastra Agent instances (camelCase)
- Tools: `xxxTool` — Mastra createTool instances (camelCase)
- API routes: `/api/resource` RESTful
- Frontend: React function components, hooks in `hooks/`, pages in `pages/`

### Error Handling
- Agents use Mastra tool calls; workflow catches and records failures in context
- `Promise.allSettled` for parallel operations (Discovery Agent, enrichment batches)
- Retry with exponential backoff for rate-limited APIs (EventFinda: 1 req/sec limit)
- Graceful degradation: if scraping fails, use cached/mock data

### Acontext Integration Pattern

The pipeline uses **Acontext** (`@acontext/acontext`) for durable workflow state persistence via a **write-through cache** architecture.

#### Architecture: Write-Through Cache
- **Reads** always hit the in-memory `Map` (zero-latency, synchronous)
- **Writes** update memory first, then fire-and-forget a `storeMessage()` call to Acontext
- Acontext failures are caught and logged — they never interrupt the workflow
- Falls back to pure in-memory when `ACONTEXT_API_KEY` is unset

#### Session Layout
One Acontext session per workflow run. Each state mutation appends a `role:"assistant"` OpenAI-format message tagged with `meta.type`, making the full workflow trajectory inspectable in the Acontext Dashboard.

```
Session: workflow-{timestamp}-{random}
│
├─ workflow_initialized    (initial WorkflowState snapshot)
├─ intent_parsed           (UserIntent stored)
├─ phase_transition        (intent_parsing → event_discovery)
├─ agent_state_updated     (discovery-agent: running)
├─ events_discovered       (Event[] stored, summaries logged)
├─ agent_state_updated     (discovery-agent: completed)
├─ phase_transition        (event_discovery → recommendation)
├─ agent_state_updated     (recommendation-agent: running)
├─ events_ranked           (top 3 Event[] stored)
├─ agent_state_updated     (recommendation-agent: completed)
├─ phase_transition        (recommendation → plan_approval)
├─ agent_state_updated     (planning-agent: running)
├─ itinerary_planned       (Itinerary stored)
├─ agent_state_updated     (planning-agent: completed)
├─ phase_transition        (plan_approval → completed)
```

#### Per-Agent Context Storage

The `ContextManager` is instantiated per workflow run in the `POST /api/workflow` route and registered in `contextRegistry` keyed by `workflowId`. Each pipeline step retrieves it via `contextRegistry.get(traceContext.getStore())` and calls the appropriate storage method:

| Pipeline Phase | Agent | Context Calls | What’s Stored |
|---|---|---|---|
| **Intent** | `intentAgent` | `updateAgentState('intent-agent', 'completed')`, `updateWorkflowPhase('event_discovery')` | Agent completion status, phase transition to discovery |
| **Discovery** | `discoveryAgent` (2 tools) | `updateAgentState('discovery-agent', 'running')` → `storeDiscoveredEvents(events)` → `updateAgentState('discovery-agent', 'completed')` → `updateWorkflowPhase('recommendation')` | Raw Event[] from Eventbrite + EventFinda, agent lifecycle, phase transition |
| **Recommendation** | `recommendationAgent` + `rankEventsTool` | `updateAgentState('recommendation-agent', 'running')` → `storeRankedEvents(top3)` → `updateAgentState('recommendation-agent', 'completed')` → `updateWorkflowPhase('plan_approval')` | Top 3 ranked events, agent lifecycle, phase transition |
| **Planning** | `planningAgent` + `planItineraryTool` | `updateAgentState('planning-agent', 'running')` → `storeItinerary(itinerary)` → `updateAgentState('planning-agent', 'completed')` → `updateWorkflowPhase('completed')` | Itinerary with time blocks, logistics, plan metadata |
| **Error** | Any | `addError(message)` | Error string appended to `workflow.errors[]` |

#### ContextManager API

```typescript
// Initialization (called in workflow route)
const ctx = createContextManager();
await ctx.initializeWorkflow(userId);  // Creates Acontext session async
contextRegistry.set(workflowId, ctx);  // Register for pipeline access

// State storage (called by pipeline steps)
await ctx.storeUserIntent(intent);
await ctx.storeDiscoveredEvents(events);
await ctx.storeRankedEvents(events);
await ctx.storeItinerary(itinerary);
await ctx.storeBookingActions(actions);

// Phase & agent tracking
await ctx.updateWorkflowPhase('event_discovery');
await ctx.updateAgentState({ agentId, status, timestamp });

// Custom data
await ctx.setCustomData('key', value);
const val = await ctx.getCustomData<T>('key');

// Reads (always from in-memory cache)
const state = await ctx.getWorkflowState();
const agents = await ctx.getAgentStates();
const phases = await ctx.getPhaseHistory();
```

#### Cleanup
Context managers are removed from `contextRegistry` 5 minutes after pipeline completion/failure to prevent memory leaks (`setTimeout(() => contextRegistry.delete(workflowId), 5 * 60 * 1000)`).

### Authentication Pattern
- **Client-side**: Supabase JS SDK handles login, signup, logout, session management
- **Server-side**: Express middleware verifies Supabase JWTs via `supabaseAdmin.auth.getUser(token)`
- **No backend login/signup routes** — all auth flows happen client-side through Supabase
- **`requireAuth` middleware** attaches `req.user` with `{ id, email }` to protected routes
- **Frontend `apiClient`** auto-attaches Supabase session token to all API requests

### Shared Types Pattern
- TraceEvent types defined once in `shared/types/trace.ts`
- Backend re-exports via `src/tracing/sse-exporter.ts` using `export type { ... } from '@shared/types/trace.js'`
- Frontend re-exports via `ui/src/types/trace.ts` using `export type { ... } from '@shared/types/trace'`
- Path alias `@shared/*` configured in root `tsconfig.json`, `ui/tsconfig.app.json`, and `ui/vite.config.ts`
- Add new shared types to `shared/types/` — never duplicate definitions between backend and frontend


### Color Scheme — "Ink Wash"

A charcoal, cool gray, soft ivory, and steel blue palette for a gallery-like, high-contrast aesthetic.

| Swatch | Hex | HSL | Role |
|--------|---------|------|------|
| Charcoal | `#4A4A4A` | 0° 0% 29% | Dark mode background base |
| Cool Gray | `#CBCBCB` | 0° 0% 79.6% | Borders, muted elements, secondary |
| Soft Ivory | `#FFFFE3` | 60° 100% 94.5% | Light mode background base |
| Steel Blue | `#6D8196` | 210° 16% 50.8% | Primary / accent |

**Light mode**: Ivory background, charcoal text, steel blue primary, cool gray borders.
**Dark mode**: Charcoal background, ivory text, lighter steel blue primary, darker gray borders.

**Shader Gradient** (`UnifiedShaderGradient.tsx`):
- Light: `#CBCBCB`, `#FFFFE3`, `#6D8196`
- Dark: `#6D8196`, `#4A4A4A`, `#3A3A3A`

**CSS Variables**: Defined in `ui/src/index.css` via HSL values in `:root` (light) and `.dark` selectors.
All Tailwind color tokens (`background`, `foreground`, `primary`, `accent`, etc.) derive from these variables.

### UI Design Principles

All UI work **must** adhere to the 7 core principles from [Figma's UI Design Principles](https://www.figma.com/resource-library/ui-design-principles/). Reference this checklist before submitting any frontend PR.

#### 1. Hierarchy
- Use font size, weight, and color to distinguish primary content from secondary.
- Headings must follow a logical order (`h1` → `h2` → `h3`); never skip levels for styling purposes.
- Most important actions (CTAs) should be visually dominant — use `primary` color/variant.
- Secondary actions should be visually subdued — use `secondary`, `outline`, or `ghost` variants.

#### 2. Progressive Disclosure
- Don't overwhelm users with everything at once. Reveal complexity step-by-step.
- Multi-step flows (e.g., onboarding) must show a progress indicator so users know where they are.
- Use collapsible sections, modals, or tabs to hide non-essential details until needed.

#### 3. Consistency
- Use shadcn/ui components exclusively — never build custom components that duplicate existing ones.
- Buttons, cards, inputs, and spacing must look and behave identically across all pages.
- Tailwind tokens only (`bg-background`, `text-foreground`, `text-primary`, etc.) — no hardcoded hex/rgb values in components.
- Follow the same layout grid and spacing scale (`gap-4`, `p-6`, `space-y-4`, etc.) project-wide.

#### 4. Contrast
- Use high contrast for primary actions and critical information.
- Destructive actions must use `destructive` variant (red) to clearly communicate risk.
- Secondary/tertiary actions should be visually lower-contrast so they don't compete with primary CTAs.

#### 5. Accessibility
- All images must have meaningful `alt` text (or `alt=""` for decorative images).
- Interactive elements must have visible `:focus-visible` outlines — never remove focus rings.
- Maintain WCAG 2.1 AA minimum contrast ratios (4.5:1 for normal text, 3:1 for large text).
- Use semantic HTML: `<button>` for actions, `<a>` for navigation, `<nav>`, `<main>`, `<section>` for structure.
- Forms must have associated `<label>` elements or `aria-label` attributes.
- Keyboard navigation must work for all interactive flows.

#### 6. Proximity
- Group related elements with consistent spacing; separate unrelated groups with larger gaps.
- Form labels must be visually close to their inputs (not floating far above/below).
- Action buttons should be near the content they act upon.

#### 7. Alignment
- Use Tailwind's grid/flex utilities for consistent alignment — no manual pixel offsets.
- Text and elements should align to a consistent edge (left-align body content, center-align hero sections).
- Maintain consistent padding within cards, sections, and containers across all pages.
