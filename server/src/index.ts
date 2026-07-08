import 'dotenv/config';
// Must be imported before any agent logic so the tracer provider is registered
// before the first span is created.
import './instrumentation';
import { shutdownTracing } from './instrumentation';
import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import cors from 'cors';
import express from 'express';
import type { AgentRunForwardedProps } from '@dairy/shared';
import { isSeeded } from './db';
import { runAgentStream } from './agent/stream';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SEED_HINT =
  'The database has not been seeded yet. Run `npm run seed -w server` first.';

app.get('/api/health', (_req, res) => {
  if (!isSeeded()) {
    return res.status(503).json({ status: 'unseeded', message: SEED_HINT });
  }
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  res.json({ status: 'ok', seeded: true, anthropicKey: hasKey });
});

// AG-UI streaming endpoint: the sole agent transport.
app.post('/api/agent/run', async (req, res) => {
  const input = (req.body ?? {}) as Partial<RunAgentInput> & {
    forwardedProps?: AgentRunForwardedProps;
  };
  const threadId = input.threadId || randomUUID();
  const runId = input.runId || randomUUID();

  const encoder = new EventEncoder({ accept: req.headers.accept });
  res.status(200);
  res.setHeader('Content-Type', encoder.getContentType());
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as { flushHeaders?: () => void }).flushHeaders?.();

  const emit = (event: BaseEvent) => res.write(encoder.encode(event));

  if (!isSeeded() || !process.env.ANTHROPIC_API_KEY) {
    emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
    emit({
      type: EventType.RUN_ERROR,
      message: !isSeeded()
        ? SEED_HINT
        : 'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.',
      code: 'unavailable',
    } as BaseEvent);
    return res.end();
  }

  const fp = (input.forwardedProps ?? {}) as AgentRunForwardedProps;
  const messages = Array.isArray(fp.messages) ? fp.messages : [];
  const approvals = Array.isArray(fp.approvals) ? fp.approvals : [];

  try {
    await runAgentStream({
      threadId,
      runId,
      messages: messages as never,
      approvals,
      emit,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[agent/run] error:', err);
    emit({ type: EventType.RUN_ERROR, message, code: 'agent_error' } as BaseEvent);
  } finally {
    res.end();
  }
});

const server = app.listen(PORT, () => {
  console.log(`dairy-agent server listening on http://localhost:${PORT}`);
  if (!isSeeded()) console.warn(`[warn] ${SEED_HINT}`);
});

// Flush buffered Langfuse spans before exit so short-lived dev runs don't drop
// the last traces on Ctrl-C / container stop.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, flushing traces...`);
  server.close();
  await shutdownTracing();
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
