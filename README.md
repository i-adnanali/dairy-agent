# Dairy Farm Management Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/i-adnanali/dairy-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/i-adnanali/dairy-agent/actions/workflows/ci.yml)

A working AI **multi-agent system** for managing a dairy farm. Two agents share
one process: a **dairy agent** (animals, milk yields, feed, health events) and a
**vendor/sales agent** (vendors, deliveries, balances), with one deliberate point
of contact — reconciling milk *produced* against milk *delivered*. A thin
per-turn dispatcher routes each message to the right agent (or both). The agents
answer questions about the farm **and take real actions** — but every
state-changing action is gated behind an explicit human confirmation.

The multi-agent design (and what was deliberately *not* built — no second
service/A2A, no orchestrator LLM, no auth) is documented in
[docs/MULTI_AGENT.md](docs/MULTI_AGENT.md).

![Welcome state of the dairy agent chat UI](docs/images/welcome_state.png)
![Digest table returned by the agent](docs/images/digest_table.png)
![Milk-yield chart with hover interaction](docs/images/chart_hover_demo.gif)

It is built as an npm-workspaces monorepo with an **Angular frontend** backed by
one Express server:

```
dairy-agent/
  shared/       # TypeScript types shared by server + web (single source of truth)
  server/       # Express + Anthropic SDK orchestrator, SQLite, tools, dispatcher, two agents
  web-angular/  # Angular 22 (standalone, zoneless) + Tailwind + ng2-charts frontend
```

> **Archived:** an earlier React frontend and its blocking `POST /api/chat`
> route (plus `server/src/agent/loop.ts`) were removed once Angular became the
> sole actively developed target. They remain permanently checkable via git
> history at the `archive/react-frontend-final` and `v0.2.0` tags; the reasoning
> is in [docs/AGUI_MIGRATION.md](docs/AGUI_MIGRATION.md).

### The agent protocol

The Angular frontend talks to the agent over a single streaming endpoint:

| Frontend       | Endpoint             | Transport                                   |
| -------------- | -------------------- | ------------------------------------------- |
| `web-angular/` | `POST /api/agent/run`| [AG-UI](https://docs.ag-ui.com) streaming events over SSE. |

`/api/agent/run` streams the turn as AG-UI events (`RUN_STARTED`,
`TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`, plus app-specific `CUSTOM`
events — `agent.dataset`, `agent.messages`, `agent.pending`, and `agent.selection`
for which agent handled the turn), so the Angular UI shows text token-by-token,
tool-call chips, and a per-turn agent tag as they happen. Tracing lives one layer
below the transport, in the shared agent logic (tools, read/write split, digest
shaper, confirmation gating). The multi-agent design is in
[docs/MULTI_AGENT.md](docs/MULTI_AGENT.md); the Angular port in
[docs/ANGULAR_PORT.md](docs/ANGULAR_PORT.md); the AG-UI migration and its design
decisions in [docs/AGUI_MIGRATION.md](docs/AGUI_MIGRATION.md).

## Tech stack

- **Server:** Node, TypeScript, Express, official Anthropic SDK
  (`@anthropic-ai/sdk`). AG-UI SSE streaming (`@ag-ui/encoder` + `@ag-ui/core`)
  via `anthropic.messages.stream()` for `/api/agent/run`.
- **Observability:** self-hosted [Langfuse](https://langfuse.com) via its
  OTel-based JS SDK (`@langfuse/tracing`, `@langfuse/otel`,
  `@opentelemetry/sdk-node`); see [Observability](#observability-langfuse).
- **Database:** SQLite via `better-sqlite3` (synchronous, zero-config).
- **Frontend (Angular):** Angular 22 standalone + zoneless, signals, Tailwind CSS,
  `ng2-charts` (Chart.js), `marked` + `DOMPurify` for markdown.
- **Model:** default `claude-sonnet-4-6` (override with `ANTHROPIC_MODEL`); falls
  back to the latest Sonnet if the configured model string is rejected.

> **Node version:** the **Angular 22** frontend requires Node
> `^22.22.3 || ^24.15.0 || >=26`. Use a satisfying version (e.g. via `nvm`).

## Setup & run

```bash
# 1. install (compiles the better-sqlite3 native binding)
npm install

# 2. configure your key
cp .env.example .env        # then edit .env and add ANTHROPIC_API_KEY

# 3. create + seed the SQLite database (idempotent: drop + recreate)
npm run seed -w server      # creates server/dairy.db

# 4. run server (:4000) + Angular web (:4200); ng proxies /api -> :4000
npm run dev:angular
```

Then open <http://localhost:4200> (Angular).

`GET /api/health` returns `{ status: "ok", seeded: true, anthropicKey: <bool> }`
once the DB is seeded. If you start the server before seeding, the health check
and agent endpoint return a friendly "run `npm run seed` first" message instead
of failing obscurely.

### Useful scripts

- `npm run seed -w server` — recreate and seed `server/dairy.db` (fixed RNG, so
  the data — and the milk-yield trend — is reproducible).
- `npm run typecheck` — typecheck shared + server.
- `npm run build:angular` — build shared + the Angular frontend.
- `npm test -w server` — sanity tests for the digest shaper.
- `npm test -w web-angular` — Vitest unit tests for the Angular frontend.

## Command reference

A consolidated cheat sheet for starting and stopping everything — the frontend,
the backend, and the self-hosted Langfuse Docker stack. See
[Setup & run](#setup--run) for the first-time flow and
[Observability](#observability-langfuse) for what the Langfuse stack is.

> **Node version first.** The Angular frontend needs Node
> `^22.22.3 || ^24.15.0 || >=26`. If you use `nvm`, the repo pins a version in
> [`.nvmrc`](.nvmrc) — run `nvm use` (or `nvm install`) in the repo root before
> the app commands below, or `ng serve` fails with a Node-version error.

### Frontend + backend (app)

```bash
# start server (:4000) + Angular (:4200) together; ng proxies /api -> :4000
npm run dev:angular
# open the app
open http://localhost:4200

# backend only (no Angular)
npm run dev -w server

# stop: press Ctrl-C in the terminal running it.
# stop a stray/backgrounded instance (frees ports 4000 + 4200):
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:4200 -sTCP:LISTEN | xargs -r kill
```

### Status / health checks

```bash
curl http://localhost:4000/api/health            # -> {"status":"ok","seeded":true,"anthropicKey":true}
docker compose -f docker-compose.langfuse.yml ps  # Langfuse container health
open http://localhost:3000                         # Langfuse UI
```

### Langfuse Docker stack

```bash
# start (Postgres, ClickHouse, Redis, MinIO, langfuse-web, langfuse-worker)
docker compose -f docker-compose.langfuse.yml up -d

# first run pulls ~6 images (a few GB); watch until all are healthy:
docker compose -f docker-compose.langfuse.yml ps

# stop + remove containers, KEEP trace data (volumes persist)
docker compose -f docker-compose.langfuse.yml down

# stop + remove containers AND drop all trace data (deletes volumes)
docker compose -f docker-compose.langfuse.yml down -v
```

> After creating a project in the Langfuse UI, copy its public + secret keys into
> `.env` (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`; `LANGFUSE_BASE_URL`
> defaults to `http://localhost:3000`) and restart the server. On startup it
> prints `[tracing] Langfuse enabled -> http://localhost:3000`. With the keys
> unset, tracing is silently disabled and the agent runs normally.

### Teardown / reset

```bash
docker compose -f docker-compose.langfuse.yml down -v   # tear down Langfuse + trace data
npm run seed -w server                                   # reset server/dairy.db to seeded state
```

> Re-seed if you approved any write actions during a session — approved writes
> mutate `server/dairy.db`, and seeding restores the reproducible baseline.

## Observability (Langfuse)

Every agent turn is traced with a **self-hosted [Langfuse](https://langfuse.com)**
instance, instrumented via its OTel-based JS SDK (`@langfuse/tracing`,
`@langfuse/otel`, `@opentelemetry/sdk-node`). Tracing sits one layer below the
AG-UI transport, in the shared tool-call/model-call logic, so it is decoupled
from the wire protocol.

```bash
# 1. start the Langfuse stack (Postgres, ClickHouse, Redis, MinIO, web + worker)
docker compose -f docker-compose.langfuse.yml up -d

# 2. open the UI, create a project, copy its keys into .env
open http://localhost:3000        # LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY

# 3. run the app as usual; traces stream to Langfuse
npm run dev:angular
```

What gets traced, per turn:

- **One trace per run**, grouped into a **session keyed by `threadId`** — so an
  approval **pause and its resume are two traces under one session**, not two
  disconnected traces.
- **A generation observation per model call**, with token counts pulled from the
  Anthropic response `usage` so Langfuse infers cost with no hand-rolled pricing
  table.
- **A tool observation per read/write tool call**, recording the model digest
  (never the raw dataset rows) as output.
- **Custom trace attributes:** `digest_size` and `dataset_rows` (to correlate
  response shape with latency/cost), `finish_reason`
  (`completed` / `iteration_cap` / `awaiting_approval`), and `agent`
  (`dairy` / `vendor` / `both` — which agent the dispatcher routed the turn to).

If the `LANGFUSE_*` keys are unset, tracing is silently disabled and the agent
runs normally.

## How this demonstrates assistant → agent

This demo is built to make four principles **observably true** in the running
app. Here is exactly where each one lives in the code:

### 1. The agent loop (interpret → execute → digest)

The model's native tool-calling drives everything — there is no hand-written
intent parsing. The loop in
[`server/src/agent/stream.ts`](server/src/agent/stream.ts) sends the conversation
+ tool schemas to the model, runs whatever tools it calls, feeds results back,
and repeats until the model stops calling tools and writes the final answer. Tool
schemas live in [`server/src/tools/index.ts`](server/src/tools/index.ts) and the
system prompt (with a live farm catalog injected) in
[`server/src/agent/systemPrompt.ts`](server/src/agent/systemPrompt.ts).

The one deliberate, narrow exception to "no hand-written intent parsing" is the
**dispatcher** ([`server/src/agent/dispatch.ts`](server/src/agent/dispatch.ts)):
per turn it selects which agent — `dairy`, `vendor`, or `both` (the safe
default) — sees the turn, and the loop offers only that agent's tools + system
prompt. It only *routes*; each agent still reasons over its own tools exactly as
above. Reconciliation (`get_yield_vs_deliveries`) is offered only to `both`,
since it's the one tool that spans both domains.

### 2. Read/write split (writes are human-gated)

Read tools (dairy: [`server/src/tools/reads.ts`](server/src/tools/reads.ts);
vendor: [`server/src/tools/vendorReads.ts`](server/src/tools/vendorReads.ts))
execute automatically inside the loop. Write tools (dairy:
[`server/src/tools/writes.ts`](server/src/tools/writes.ts); vendor:
[`server/src/tools/vendorWrites.ts`](server/src/tools/vendorWrites.ts)) never run
on their own: when the model calls one, `runAgentStream` **pauses** and emits a
`PendingWrite` confirmation card (via the `agent.pending` CUSTOM event). Nothing is written until the
user approves; the resume path executes only the approved writes and records a
"declined" tool result for the rest. Re-sending the same approval does not
double-write, because the server is stateless and only mutates on an explicit
approval decision in that request. Both agents share this exact pause/resume
mechanism.

### 3. Display data is not reasoning data

`get_milk_yield` runs through the digest shaper in
[`server/src/tools/shaper.ts`](server/src/tools/shaper.ts). The **full time
series** (every bucket) is shipped to the client as a `Dataset` and rendered as
a chart — it **never enters the model's context**. The model receives only a
small **digest** (totals, mean, min/max, first/last, period-over-period %). You
can watch this in Langfuse: each read tool call is traced as its own observation,
with the model digest (not the raw rows) recorded as its output.

### 4. Wrong cheaply, never expensively

- **Bad args → structured errors the model can retry.** Read tools return
  `{ error: ... }` digests (e.g. `missing_scope`, `unknown_group`) instead of
  throwing.
- **Hallucinated IDs are blocked for free.** The ID-integrity guard
  (`guardIds` in [`server/src/tools/index.ts`](server/src/tools/index.ts)) checks
  every `animal_id`/`group`/`vendor_id`/`delivery_id` against the DB *before* any
  tool runs.
- **Oversized requests are capped deterministically.** The shaper coarsens
  `day → week` past 90 days and `→ month` past a year before doing any work, so a
  huge range can't blow up the dataset or the digest.
- **The loop is bounded.** `max_tokens` per call and a max-iteration cap (with a
  graceful "narrow it down" message) live in `stream.ts`.

## Scale design

The herd is ~14 animals, so the full catalog fits cheaply in the system prompt.
But `search_animals` is already implemented with a top-K bound (8) and a
`tooMany` flag, and `buildSystemPrompt` will omit the inline animal list and
steer the model to `search_animals` once the herd exceeds a threshold (300).
The seam is wired even though the demo never crosses it.

## Out of scope

No auth/multi-user, no deletes, no IoT/hardware, no cloud deploy. Single-operator
local demo backed by a local SQLite file.
