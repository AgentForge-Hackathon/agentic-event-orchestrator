# Architecture — Agentic Itinerary Planner

The Agentic Itinerary Planner is an autonomous logistics system that discovers, ranks, plans, and executes real-world event itineraries. It uses a multi-agent orchestration layer to transform natural language intent into verified bookings with full explainability through a real-time tracing system.

## High-Level System Architecture

The system follows a modern web architecture with a React frontend communicating via a REST API to an Express backend. The backend orchestrates a network of Mastra agents and tools, integrating with multiple external services for event discovery, LLM reasoning, and browser-based execution.

```mermaid
graph TD
    User([User Browser])
    
    subgraph Frontend [React 19 + Vite]
        UI[UI Components]
        TraceView[Trace Viewer]
        APIClient[API Client]
    end
    
    subgraph Backend [Express API Server]
        Mastra[Mastra Engine]
        Workflow[Planning Pipeline]
        Bus[TraceEventBus]
        SSE[SSE Stream]
        Auth[Supabase Auth Middleware]
    end
    
    subgraph Services [External Services]
        OpenAI[OpenAI GPT-4o-mini]
        BrightData[Bright Data API]
        EventFinda[EventFinda REST API v2]
        Actionbook[Actionbook SDK + CLI]
        Acontext[Acontext SDK]
    end
    
    subgraph Storage [Persistence Layer]
        Supabase[(Supabase - Postgres)]
        MongoDB[(MongoDB - Mongoose)]
    end

    User <--> UI
    UI --> APIClient
    APIClient --> Auth
    Auth --> Workflow
    Workflow --> Mastra
    
    Mastra --> OpenAI
    Mastra --> BrightData
    Mastra --> EventFinda
    Mastra --> Actionbook
    Workflow --> Acontext
    
    Workflow --> Bus
    Bus --> SSE
    SSE --> TraceView
    
    Backend --> Supabase
    Backend --> MongoDB
```

## Agent Pipeline Flow

The planning pipeline is an asynchronous workflow that progresses through intent understanding, discovery, ranking, and planning before pausing for human approval. Once approved, it proceeds to automated execution using real browser interaction.

```mermaid
sequenceDiagram
    participant U as User (Frontend)
    participant E as Express API
    participant P as Planning Pipeline
    participant A as Mastra Agents
    participant T as Tools
    participant AB as Actionbook

    U->>E: POST /api/workflow (PlanFormData)
    E->>P: Create Workflow Run
    E-->>U: Return workflowId (immediate)
    
    Note over P: traceContext.run(workflowId)
    
    rect rgb(240, 240, 240)
    Note right of P: Step 1: Intent
    P->>A: intentAgent.generate()
    A-->>P: UserConstraints
    end
    
    rect rgb(240, 240, 240)
    Note right of P: Step 2: Discovery
    P->>T: .parallel([searchEventbrite, searchEventfinda])
    T-->>P: Raw Event List
    P->>T: deduplicateEvents + HallyuCon Injection
    end
    
    rect rgb(240, 240, 240)
    Note right of P: Step 3: Ranking
    P->>T: rankEventsTool (Deterministic Scoring)
    P->>A: recommendationAgent.generate() (Narrative)
    end
    
    rect rgb(240, 240, 240)
    Note right of P: Step 4: Planning
    P->>T: planItineraryTool -> planningAgent.generate()
    T-->>P: Itinerary JSON
    end
    
    rect rgb(255, 230, 230)
    Note right of P: Step 5: Approval Gate
    P->>U: Emit plan_approval Trace
    Note over P: Pipeline PAUSES
    U->>E: POST /api/workflow/:id/approve
    E->>P: Resolve Approval Promise
    end
    
    rect rgb(230, 255, 230)
    Note right of P: Step 6: Execution
    loop For each bookable item
        P->>T: executeBookingTool
        T->>AB: Browser Automation Flow
        AB-->>P: Booking Confirmation
    end
    end
    
    Note over P,U: Throughout: emitTrace() -> TraceEventBus -> SSE -> TraceViewer
```

## Agent & Tool Dependency Map

This map illustrates the relationship between Mastra agents and their associated tools. While agents use tools for LLM-driven reasoning, the pipeline frequently calls tools directly to ensure deterministic behavior and higher performance.

```mermaid
graph LR
    subgraph Agents [Mastra Agents - GPT-4o-mini]
        IA[intentAgent]
        DA[discoveryAgent]
        RA[recommendationAgent<br/>Reasoning Only]
        PA[planningAgent<br/>Reasoning Only]
        EA[executionAgent]
    end

    subgraph Tools [Mastra Tools]
        PIT[parseIntentTool]
        SEB[searchEventbriteTool]
        SEF[searchEventfindaTool]
        DET[deduplicateEventsTool]
        RET[rankEventsTool]
        PLT[planItineraryTool]
        EBT[executeBookingTool]
        BT[11 Browser Tools]
    end

    Pipeline((Pipeline<br/>Direct Calls))

    IA -->|registered| PIT
    DA -->|registered| SEB
    DA -->|registered| SEF
    DA -->|registered| DET
    EA -->|registered| EBT
    EA -->|registered| BT

    Pipeline -.->|direct execute| SEB
    Pipeline -.->|direct execute| SEF
    Pipeline -.->|direct execute| DET
    Pipeline -.->|direct execute| RET
    Pipeline -.->|direct execute| PLT
    Pipeline -.->|direct execute| EBT

    PLT -->|invokes internally| PA

    style Pipeline fill:#f9f,stroke:#333,stroke-width:2px
    style RA fill:#eee,stroke:#999,stroke-dasharray: 5 5
    style PA fill:#eee,stroke:#999,stroke-dasharray: 5 5
```

## Real-Time Tracing Data Flow

The tracing system captures both high-level narrative events from the pipeline and low-level technical spans from the Mastra engine. These are merged into a unified stream that provides the frontend with a comprehensive view of the agent's thought process.

```mermaid
graph TD
    subgraph Source1 [Custom Narrative]
        Steps[Pipeline Steps] --> ET[emitTrace helper]
    end
    
    subgraph Source2 [Auto-Instrumented]
        Mastra[Mastra Engine] --> Exp[SSETracingExporter]
        Exp --> Map[Map Span to TraceEvent]
    end
    
    ET --> Bus[TraceEventBus]
    Map --> Bus
    
    subgraph Distribution [Trace Distribution]
        Bus --> PubSub[Pub/Sub with History]
        PubSub --> SSE[GET /api/traces/stream/:workflowId]
    end
    
    subgraph FrontendView [Trace Viewer UI]
        SSE --> Hook[useTraceStream Hook]
        Hook --> Stepper[PipelineProgress]
        Hook --> Banner[ActiveAgentBanner]
        Hook --> Tree[SpanCard Tree]
        Tree --> Bubbles[Reasoning / Decisions / Approval]
    end
```

## Database Architecture

A dual-database approach leverages Supabase for identity and structured event caching, while MongoDB handles the flexible, document-based nature of completed itineraries and their embedded snapshots.

```mermaid
graph TD
    subgraph Supabase [Supabase - Postgres]
        Profiles[(profiles)]
        Events[(events)]
        Legacy[(Legacy Tables - Unused)]
    end
    
    subgraph Mongo [MongoDB - Mongoose]
        Itineraries[(itineraries collection)]
        Items[Embedded items array]
    end
    
    API[Express API]
    
    API -- "auth/onboarding" --> Profiles
    API -- "GET /api/events" --> Events
    API -- "persistItinerary()" --> Itineraries
    Itineraries --- Items
    API -- "GET /api/itineraries" --> Itineraries
    
    Scraper[Scrapers] -- "service-role write" --> Events
```

## Authentication Flow

Authentication is managed client-side by the Supabase SDK, with the backend performing stateless JWT verification. This ensures all protected resources are secured by user-scoped identity throughout the system.

```mermaid
sequenceDiagram
    participant U as User
    participant S as Supabase Auth
    participant F as Frontend Client
    participant B as Backend API
    
    U->>S: Login / Signup
    S-->>U: Session Token (JWT)
    U->>F: Store Token
    
    F->>B: Request with Bearer Token
    Note over B: requireAuth Middleware
    B->>S: admin.auth.getUser(token)
    S-->>B: User Profile
    B->>B: Attach req.user
    B-->>F: Protected Data / Action
```

## Context Manager (Write-Through Cache)

The Context Manager provides a durable yet high-performance state management solution for workflows. It prioritizes zero-latency in-memory access for the active pipeline while ensuring every state change is asynchronously persisted to Acontext.

```mermaid
graph LR
    Pipeline[Workflow Pipeline]
    Registry[contextRegistry Map]
    Memory[(In-Memory Cache)]
    Acontext[Acontext SDK]
    
    Pipeline -- "get context" --> Registry
    Registry -- "workflowId" --> Memory
    
    Pipeline -- "Reads" --> Memory
    
    Pipeline -- "Writes" --> Update[Update Memory]
    Update --> FireForget[Fire-and-Forget]
    FireForget -- "storeMessage()" --> Acontext
    
    subgraph TTL [Cleanup]
        Memory -- "5min after complete" --> Delete[Delete from Registry]
    end
```

## Frontend Component Architecture

The frontend is structured around a guided wizard flow that transitions into a real-time observation mode during planning. It uses a recursive component structure to render the hierarchical trace tree emitted by the backend.

```mermaid
graph TD
    App[App] --> Routes[AppRoutes]
    Routes --> Guard[ProtectedRoute]
    
    Guard --> Landing[Index Page]
    Landing --> Hero[HeroSection]
    Landing --> Home[AuthenticatedHome]
    
    Guard --> Plan[PlanPage]
    Plan --> Wizard[4-Step Wizard]
    Wizard -- "on submit" --> SSE[useTraceStream]
    SSE --> TV[TraceViewer]
    
    TV --> Progress[PipelineProgress]
    TV --> Banner[ActiveAgentBanner]
    TV --> Cards[SpanCard Tree - Recursive]
    Cards --> Detail[Reasoning / Decision / Approval]
    
    Guard --> Itin[ItinerariesPage]
    Itin --> Hook[useItineraries]
    
    Guard --> Dash[DashboardPage]
    Guard --> Evts[EventsPage]
```

## Key Design Decisions

- **SSE over WebSocket**: Chose Server-Sent Events for real-time tracing because the data flow is primarily one-directional (server to client), it's simpler to implement, has native browser support with automatic reconnection, and avoids the overhead of a full duplex connection.
- **Dual Database Strategy**: Used Supabase (Postgres) for its robust authentication and RLS policies, while using MongoDB for itinerary persistence to easily store complex, nested document structures with denormalized event snapshots without rigid schema migrations.
- **Direct Tool Execution**: The pipeline calls specific tools (discovery, ranking, booking) directly rather than through an agent's reasoning loop. This ensures deterministic performance, avoids LLM hallucinations for known logic, and significantly reduces latency and token cost.
- **Write-Through Cache for Context**: Implemented a pattern where reads always hit in-memory storage for zero-latency, while writes are asynchronously backed up to Acontext. This ensures the pipeline is never slowed down by external persistence calls while remaining durable.
- **HallyuCon Injection**: To ensure a reliable demo experience, the system injects a "HallyuCon" event (a real free Eventbrite RSVP) into the discovery results. This guarantees that a bookable, free-of-charge event is always available for the execution agent to demonstrate the full browser automation flow.
