# Dairy Farm Management Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/i-adnanali/dairy-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/i-adnanali/dairy-agent/actions/workflows/ci.yml)

A working AI **agent** for managing a dairy farm's animals, milk yields, feed, and
health events. The agent answers questions about the farm **and takes real
actions** — but every state-changing action is gated behind an explicit human
confirmation.

![Welcome state of the dairy agent chat UI](docs/images/welcome_state.png)
![Digest table returned by the agent](docs/images/digest_table.png)
![Milk-yield chart with hover interaction](docs/images/chart_hover_demo.gif)

It is built as an npm-workspaces monorepo with an **Angular frontend** backed by
one Express server:

```
dairy-agent/
  shared/       # TypeScript types shared by server + web (single source of truth)
  server/       # Express + Anthropic SDK orchestrator, SQLite, tools, agent loop
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
events for chart datasets, history, and pending writes), so the Angular UI shows
text token-by-token and tool-call chips as they happen. Tracing lives one layer
below the transport, in the shared agent logic (tools, read/write split, digest
shaper, confirmation gating). The Angular port is documented in
[docs/ANGULAR_PORT.md](docs/ANGULAR_PORT.md); the AG-UI migration and its design
decisions are in [docs/AGUI_MIGRATION.md](docs/AGUI_MIGRATION.md).

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
  response shape with latency/cost) and `finish_reason`
  (`completed` / `iteration_cap` / `awaiting_approval`).

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

### 2. Read/write split (writes are human-gated)

Read tools ([`server/src/tools/reads.ts`](server/src/tools/reads.ts)) execute
automatically inside the loop. Write tools
([`server/src/tools/writes.ts`](server/src/tools/writes.ts)) never run on their
own: when the model calls one, `runAgentStream` **pauses** and emits a
`PendingWrite` confirmation card (via the `dairy.pending` CUSTOM event). Nothing is written until the
user approves; the resume path executes only the approved writes and records a
"declined" tool result for the rest. Re-sending the same approval does not
double-write, because the server is stateless and only mutates on an explicit
approval decision in that request.

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
  every `animal_id`/`group` against the DB *before* any tool runs.
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
