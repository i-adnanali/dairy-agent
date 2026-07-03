import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import type { ChatRequest } from '@dairy/shared';
import { isSeeded } from './db';
import { runTurn } from './agent/loop';

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

app.listen(PORT, () => {
  console.log(`dairy-agent server listening on http://localhost:${PORT}`);
  if (!isSeeded()) console.warn(`[warn] ${SEED_HINT}`);
});
