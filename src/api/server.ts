import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { env } from '../config.js';
import { authRouter } from './routes/auth.js';
import { workflowRouter } from './routes/workflow.js';
import { tracesRouter } from './routes/traces.js';
import { eventsRouter } from './routes/events.js';
import { itinerariesRouter } from './routes/itineraries.js';
import { connectMongo } from '../mongodb/index.js';

const app = express();

// ---------------------
// Middleware
// ---------------------
app.use(cors());
app.use(express.json());

// ---------------------
// Connect to MongoDB
// ---------------------
await connectMongo();

// ---------------------
// Health check
// ---------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// ---------------------
// Routes
// ---------------------
app.use('/api/auth', authRouter);

app.use('/api/workflow', workflowRouter);
app.use('/api/events', eventsRouter);
app.use('/api/itineraries', itinerariesRouter);
app.use('/api/traces', tracesRouter);

// ---------------------
// Global error handler
// ---------------------
// Must have 4 params for Express to treat it as an error-handling middleware.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------
// Start server
// ---------------------
app.listen(env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Demo mode: ${env.DEMO_MODE}`);
});

export { app };
