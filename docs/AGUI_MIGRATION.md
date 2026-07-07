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
