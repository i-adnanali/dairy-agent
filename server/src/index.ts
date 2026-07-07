import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import cors from 'cors';
import express from 'express';
import type { AgentRunForwardedProps, ChatRequest } from '@dairy/shared';
import { isSeeded } from './db';
import { runTurn } from './agent/loop';
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

app.post('/api/chat', async (req, res) => {
  if (!isSeeded()) {
    return res.status(503).json({ error: 'unseeded', message: SEED_HINT });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'no_api_key',
      message:
        'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.',
    });
  }

  const body = req.body as ChatRequest;
  if (!body || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: 'bad_request', message: 'messages[] is required.' });
  }

  try {
    const result = await runTurn(body.messages as never, body.approvals ?? []);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat] error:', err);
    res.status(500).json({ error: 'agent_error', message });
  }
});

// AG-UI streaming endpoint. Runs alongside /api/chat (which is untouched).
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

app.listen(PORT, () => {
  console.log(`dairy-agent server listening on http://localhost:${PORT}`);
  if (!isSeeded()) console.warn(`[warn] ${SEED_HINT}`);
});
