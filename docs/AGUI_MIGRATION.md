# Dairy Farm Agent - AG-UI Protocol Migration

This document is the decision log and internals reference for the migration from the
original blocking `POST /api/chat` JSON contract to an **AG-UI**-compliant streaming
(SSE) event protocol on a new `POST /api/agent/run` route.

It mirrors the structure and honesty level of [ANGULAR_PORT.md](./ANGULAR_PORT.md):
Phase 0 records the decisions taken *before* writing code, and the later sections
record what actually got built - including any place a Phase-0 decision turned out to
be wrong in practice.

The migration ran in tagged phases (`agui-migration/00-decisions` ..
`agui-migration/06-parity-qa`, then `v0.3.0`). Only the **Angular** frontend
(`web-angular/`) was migrated. `web-react/` and the old `POST /api/chat` route were
left entirely untouched during the migration.

---

## Section 0 - Decision log (taken before any code)

The AG-UI protocol does not prescribe an answer for three questions that the current
architecture depends on. Each was resolved and written down *first*.

### Verified ground truth about the ecosystem (this session)

- `@ag-ui/core`, `@ag-ui/client`, `@ag-ui/encoder`, `@ag-ui/proto` are at **`0.0.57`**
  (published Jun 2026). This is a pre-1.0 ecosystem; APIs move fast.
- **There is no `INTERRUPT` event type.** The AG-UI human-in-the-loop pattern is:
  the agent emits `RUN_FINISHED` with
  `outcome: { type: "interrupt", interrupts: [...] }`, and the client resumes by
  starting a **new run** whose `RunAgentInput` carries a `resume` array. (The earlier
  planning doc's "emit an `INTERRUPT` event" wording was wrong; corrected here.)
- Server-side, events are encoded with `EventEncoder` from `@ag-ui/encoder` and the
  `EventType` enum from `@ag-ui/core`, written to an SSE response.
- Client-side, `@ag-ui/client`'s `HttpAgent` (a concrete `AbstractAgent`) is the
  transport. Its default `requestInit()` POSTs `JSON.stringify(input)` with
  `Accept: text/event-stream`, and it exposes an `events$: Observable<BaseEvent>`
  stream plus a `forwardedProps` field on the run input. We consume `events$`
  directly - **no CopilotKit UI layer**, because this app already has a complete
  custom Tailwind UI.

### Decision 1 - How the digest/dataset split travels over AG-UI

A read tool returns `{ modelDigest, dataset? }`: the digest goes to the model (as the
tool result), the dataset goes straight to the client for charting and never touches
the model. AG-UI has no native "send this to the UI but not the model" event.

**Decision: emit the dataset as a `CUSTOM` event**
`{ type: 'CUSTOM', name: 'dairy.dataset', value: dataset }`, emitted right after the
`TOOL_CALL_RESULT` that carries the digest.

Reasoning: a `CUSTOM` event is explicit, self-describing, and decoupled from run
state. The `STATE_DELTA`-against-a-`datasets`-array alternative would force us to
introduce and manage shared run state (JSON-Patch deltas, a state snapshot lifecycle)
purely to move a value that is fire-and-forget from the model's perspective. The
dataset is not conversational state the model reasons about; it is a UI side-channel,
which is exactly what `CUSTOM` is for.

### Decision 2 - How the run/resume boundary works across an interrupt

Today, approval resumption is a brand-new HTTP request that resends the full history
plus an `approvals` array (client-authoritative, stateless server).

**Decision: keep the stateless model.** On a proposed write the server ends the run
(`RUN_FINISHED`), signalling the pending approval to the client. Approval resumption
opens a **new run** on the same `threadId`; the client resends the opaque
conversation history plus the approval decisions via the run input's `forwardedProps`.
The server reconstructs everything it needs from that payload - it holds no per-run
state between requests.

Reasoning: this is the smallest possible change from today's philosophy (the server
was already stateless; the client already owned and resent history). Holding an SSE
connection open for minutes while a human decides is impractical and fragile. AG-UI's
own interrupt model (`RUN_FINISHED { outcome: interrupt }` -> new run with `resume`)
is the same shape.

### Decision 3 - How the iteration cap maps to a lifecycle event

Today the `MAX_ITERATIONS` cap ends with a graceful `done:true` and a friendly "too
involved" message - not an error.

**Decision: emit `RUN_FINISHED` (not `RUN_ERROR`)** carrying the same friendly text as
a final assistant text message. A normal safety limit must not surface as a failure
state in the UI. `RUN_ERROR` is reserved for genuine failures (Anthropic API errors,
tool executors throwing).

---

## Section 1 - What actually got built

_(Filled in as the phases land; see the phase list in the migration plan.)_

### Custom event channels

Because the server keeps the conversation history in the opaque Anthropic block shape
(`tool_use` / `tool_result`) rather than AG-UI's `Message` shape, three app-specific
payloads travel over `CUSTOM` events instead of being mapped lossily onto native
AG-UI message/state events:

| CUSTOM `name`    | `value`                    | Purpose                                                        |
| ---------------- | -------------------------- | ------------------------------------------------------------- |
| `dairy.dataset`  | `Dataset`                  | Chart data for the client only (Decision 1).                  |
| `dairy.messages` | `AnthropicMessage[]`       | Updated opaque history for the client to store and resend.    |
| `dairy.pending`  | `PendingWrite[]`           | Writes awaiting approval (Decision 2 interrupt payload).      |

The lifecycle, text, and tool-call events are all native AG-UI events.

### Where a Phase-0 decision changed in practice: the interrupt outcome

Decision 2 planned to pause with `RUN_FINISHED { outcome: { type: "interrupt", ... } }`
in addition to the `dairy.pending` CUSTOM event ("free protocol correctness").
Live QA showed this actively breaks the client: `@ag-ui/client` records the
interrupt outcome as an open interrupt on the thread and then **rejects the next
run** unless its `RunAgentInput` carries a standard `resume[]` array addressing
that interrupt id ("Thread has N pending interrupt(s) not addressed by resume").
That conflicts with our stateless resume, which resends the opaque history plus
approvals via `forwardedProps` rather than the client's `resume[]` machinery.

**Resolution:** the write pause now ends with a **plain `RUN_FINISHED`** and
signals the pending writes purely via the `dairy.pending` CUSTOM event. This
keeps the client's interrupt state machine out of the loop, so the stateless
`forwardedProps.approvals` resume works cleanly. The rest of Decision 2 (stateless
new-run resume) stands.

### Turn model (parity with the old loop)

The streaming loop in `server/src/agent/stream.ts` mirrors `runTurn` in
`server/src/agent/loop.ts` exactly: reads are (re)executed idempotently, writes
pause for approval, and after an approved/declined write the loop continues so
the model can summarise the result. That post-approval model turn is the same
extra round-trip the old `/api/chat` did, so the assistant's wording after an
approval is identical between the two frontends — the migration changes only the
transport, never the agent semantics.

On the client, each AG-UI run maps to at most one in-progress assistant turn:
`TEXT_MESSAGE_CONTENT` appends live, `TOOL_CALL_*` build chips incrementally, and
`dairy.dataset` appends charts. A resume run's `TOOL_CALL_RESULT` (which carries
no preceding `TOOL_CALL_START` in that run) patches the existing chip by id.

### Verified end to end (Phase 6)

Against a live server + the Angular app: streamed text renders token-by-token; a
`get_milk_yield` query streams tool chips and renders the Chart.js chart from
`dairy.dataset`; `add_animal` / `log_milking` raise the confirmation card, and
Approve resumes and persists to SQLite with no client error. The `web-react/`
app and `POST /api/chat` were untouched throughout.

## Section 2 - Fate of POST /api/chat

`/api/chat` (the blocking, non-streaming JSON contract) is **retained** and
unchanged. It still backs the `web-react/` frontend, which was intentionally not
migrated. The two contracts now coexist:

- `web-react/` → `POST /api/chat` (blocking `runTurn`).
- `web-angular/` → `POST /api/agent/run` (streaming `runAgentStream`).

This is deliberate: keeping `/api/chat` lets the React app serve as a live parity
reference and avoids a big-bang cutover. If `web-react/` is ever retired,
`/api/chat` and `server/src/agent/loop.ts` can be removed together.
