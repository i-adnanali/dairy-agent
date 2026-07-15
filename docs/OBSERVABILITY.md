# Observability & Evals — Decision Doc (Cycle 1)

*Status: implemented and verified (see Verification section below).*

## Context

The AG-UI migration (`v0.3.0`) gave the Angular frontend a streaming transport (`/api/agent/run`) over the same shared agent logic (`shared/`, tool definitions, the digest shaper, the approval gate) that the original React frontend's blocking `/api/chat` used. Before this, there was no tracing at all beyond ad hoc `console.log` calls in `agent/loop.ts` and `agent/stream.ts`.

Cycle 1's goal: instrument the agent so that every run — tool calls, model calls, token usage, latency, cost, and the approval pause/resume boundary — is traceable and queryable, for `/api/agent/run` (Angular, AG-UI streaming), the only endpoint remaining after the React frontend and `/api/chat` were archived (see addendum below).

## What we're NOT doing

We are **not** instrumenting the AG-UI event stream itself. AG-UI events (`RUN_STARTED`, `CUSTOM`, `RUN_FINISHED`, etc.) are a transport-layer concern. Tracing belongs one layer down, in the tool-call/model-call logic that `stream.ts` calls into (`../tools`, `systemPrompt.ts`). This was originally decided so both `/api/chat` and `/api/agent/run` would get traced identically from one instrumentation point; with `/api/chat` now archived, the same principle still holds for the sole remaining endpoint, and keeps tracing decoupled from transport if a third one is ever added.

## Options considered

| Tool | License | Fit |
|---|---|---|
| **Langfuse** | MIT (core) | Framework-agnostic, OTel-native, native Anthropic SDK support (token/cost inference out of the box), self-hostable via Docker, largest community and integration surface. No first-class AG-UI adapter, which is fine since we're not tracing at that layer. |
| **Laminar** | Apache 2.0 | Purpose-built for agent tracing, better trace-compression economics at scale, ships a SQL editor over trace data. Smaller community, newer, less battle-tested. Most of the case for it comes from Laminar's own marketing, which discounts the enthusiasm somewhat. |
| **Arize Phoenix** | Elastic 2.0 | Strong for notebook-heavy ML/RAG eval workflows. Not a great fit for a web-app agent with a human-approval gate. |
| **Helicone** | Apache 2.0 (OSS) | Fastest possible setup (proxy, change base URL). Explicitly weaker on multi-step agent traces — request/response focused, stitches multi-step flows after the fact rather than modeling spans natively. Wrong shape for the approval pause/resume boundary. |
| **LangSmith** | Closed source | Best if locked into LangChain/LangGraph. We aren't. |
| **Braintrust / Confident AI** | Closed source, eval-first | Solve CI/CD prompt-regression-gating at deploy time — a problem this project doesn't have yet (no frequent prompt changes shipping to real users). |
| **OpenLLMetry (Traceloop SDK)** | Apache 2.0 | Not a backend — a vendor-neutral OTel instrumentation layer that most backends above (including Langfuse) can ingest. Considered as an instrumentation *strategy*, not a competing destination. |

## Decision

**Langfuse, self-hosted**, instrumented via its OTel-based JS/TS SDK (`@langfuse/tracing`, `@langfuse/otel`) at the shared agent-logic layer.

Reasoning, in order of weight:
1. MIT core, self-hostable, no license ambiguity.
2. Native Anthropic SDK support — automatic token/cost inference without hand-rolled pricing tables.
3. Largest community/documentation surface, which matters more for a single-developer project than marginal feature advantages elsewhere.
4. Session/trace/observation data model maps directly onto this app's structure (a farm-management conversation = session, one turn = trace, each tool/model call = observation), no custom schema needed.

**Known trade-off accepted:** Langfuse was recently acquired by ClickHouse. This doesn't affect the current MIT-licensed self-host path, but it's a fact worth tracking — revisit in a few months alongside the existing ClickHouse-acquisition watch item from the earlier tooling research, to see whether it changes free-tier terms or roadmap direction.

**Portability hedge:** instrumentation is written in a way that stays close to plain OTel conventions (rather than deep Langfuse-specific decorators everywhere), so a future switch to Laminar or another OTel-consuming backend would not require re-instrumenting the app from scratch.

## What gets traced

- **Every tool call and model call** in the shared `../tools` / `systemPrompt` logic used by `/api/agent/run` (see the archival addendum below — this is now the only transport).
- **Approval pause/resume as one linked session, not two disconnected traces.** Because resume is stateless (new run per resume, history/approvals via `forwardedProps`), the pause and its resume are linked via `sessionId: threadId` — `threadId` is already client-persisted across a resume (a resume opens a new run on the *same* `threadId`), so this requires no additional derivation.
- **Custom trace metadata:**
  - `digest_size` / `dataset_rows` — from the digest/dataset split carried over AG-UI `CUSTOM` events, to later correlate response shape with latency/cost.
  - `finish_reason: completed | awaiting_approval | iteration_cap` — without this flag, these cases can be hard to distinguish from the trace view alone.

## Addendum — React frontend and `/api/chat` archived

**Decision (reversal of the earlier "keep React as a frozen reference implementation" call):** `web-react/`, the `/api/chat` route in `server/src/index.ts`, and `server/src/agent/loop.ts` are archived, not maintained going forward.

**Why the earlier decision changed:** the original reasoning for keeping React alive rested on two things — using it as a cross-check while requirements were still evolving, and a narrative parallel to the FDS/`fc-ui` positioning conversation at Facelift. Both weaken once the project's requirements are settled and Angular is confirmed as the only actively developed target: maintaining a second frontend stops buying protection against an unknown future and just becomes upkeep against a target that no longer moves. The Facelift positioning argument stands on its own merits regardless of what this repo does, so it doesn't require a live two-frontend demo to hold.

**What's preserved instead of a running app:** the migration is already proven and permanently checkable via git history — the `angular-port/*` and `v0.2.0` tags — plus the corrected reasoning documented in `docs/AGUI_MIGRATION.md`. Archiving the code doesn't erase that evidence; it just stops paying an ongoing maintenance cost for a comparison that's already been made and published (Hashnode posts 3 and 4).

**Verified before archiving (not assumed):** `server/src/agent/loop.ts` is a self-contained blocking wrapper — it imports from `../tools` and `./systemPrompt`, the same shared modules `stream.ts` uses, but nothing in the codebase imports `loop.ts` itself. Removing it, the React app, and the `/api/chat` route does not touch `stream.ts`, `../tools`, or `systemPrompt.ts` — the AG-UI/Angular path is unaffected.

**Practical mechanics:** tag the current state (e.g. `archive/react-frontend-final`) before removing the code from `main`, so the git history — not a running app — remains the permanent proof, and `main` stays scoped to the one actively developed path.

**Simplification this gives Cycle 1 and Cycle 2:** the "derive a session key by hashing `messages[0]` because `/api/chat` has no identifier" problem no longer applies — there's only one transport left, with `threadId` as its natural, already-existing session key. Cycle 2's regression suite likewise only needs to assert against AG-UI event sequences; no protocol-agnostic subset run against two endpoints is needed.

## Implementation (complete)

1. ✅ Added `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node` to `server/`.
2. ✅ Self-hosted Langfuse locally via Docker.
3. ✅ Instrumented the shared tool-call/model-call layer once, in `server/src/agent/tracing.ts` and `server/src/instrumentation.ts`.
4. ✅ Approval pause/resume pairs linked into one session via `setTraceSession(threadId)`.
5. ✅ `digest_size`, `dataset_rows`, and `finish_reason` added as custom trace attributes, set at run finalization.
6. ✅ Verified end-to-end (see below).

**Opt-in, not required:** if `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are unset, the SDK never initializes and the tracing helpers are no-ops — the agent behaves exactly as it did before this cycle without them configured.

## Verification

Four phases run against the actual live app (not simulated), each checked directly against Langfuse's trace/observation data rather than taken on faith.

| Phase | Scope | Result |
|---|---|---|
| 3 — Self-hosted stack | Bring up Langfuse via Docker, wire keys | ✅ stack healthy, `[tracing] Langfuse enabled` on server boot |
| 4 — Live end-to-end | Chart read, guard rejection, approval pause, resume, one conversation | ✅ one session (`threadId`), four traces, pause/resume correctly grouped |
| 5 — Edge cases | Iteration cap, guard rejection, model fallback, unavailable API key | ✅ all four verified in both the SSE stream and the Langfuse trace shape |
| 6 — Shutdown flush | SIGINT mid-run | ✅ flush log printed, last trace present in Langfuse before process exit |

**Phase 4 detail.** A single conversation — a milk-yield chart read, a rejected write for a nonexistent animal, an approved write left pending, then its resume — produced four traces under one Langfuse session. The resume trace showed `finish_reason: "completed"`, the correct session ID, and real token/cost figures (3,742 prompt tokens, 74 completion, $0.012336), matching the plan's pass criteria exactly.

**One real nuance found by running it, not by re-reading the plan:** the plan's diagram implicitly assumed a write-approval turn would also carry `digest_size`/`dataset_rows`, since it pictured a read-then-write pattern in one turn. In the actual run, the read (a separate conversational turn) and the write (three further turns: rejected attempt, pause, resume) were different HTTP runs entirely. The pause and resume traces correctly show `digest_size: 0`, while the earlier read trace shows `digest_size: 447`, `dataset_rows: 31`. This is correct per-run behavior — each HTTP run traces only what it actually did — not a bug in either the plan or the implementation, but it's a real gap between the diagram's assumption and multi-turn reality, worth recording rather than smoothing over.

**Phase 5 detail, per edge case:**
- **Iteration cap** (`AGENT_MAX_ITERATIONS=1` + a chart read): friendly completion streamed, no error surfaced to the client; trace shows `finish_reason: "iteration_cap"` with the read tool call and model call still present under the run.
- **Guard rejection** (request for a nonexistent animal): graceful "does not exist" reply; the `get_animal` tool call is recorded at `level: WARNING` with `guardRejected: true`, and the run itself still finishes with `finish_reason: "completed"` — the warning is scoped to the specific tool call, not the whole run.
- **Model fallback** (`ANTHROPIC_MODEL` pointed at a nonexistent model): normal answer returned to the client, no visible error. The trace shows two model calls in the same run — the bad model at `level: ERROR` with zero tokens, immediately followed by a successful fallback call — and the root run's latency is exactly the sum of the two, confirming the fallback happens serially inside one trace rather than as a second disconnected run.
- **Unavailable path** (blanked `ANTHROPIC_API_KEY`): `RUN_STARTED` followed by `RUN_ERROR code:unavailable` over SSE, friendly client-facing message, no crash. No trace is created at all — correct, since the failure happens before the agent run starts, so there's nothing yet for the tracer to record.

**Phase 6 detail.** Running the server standalone (so `SIGINT` reaches the handler directly rather than through the dev-mode process wrapper), sending one turn, then sending `SIGINT`: the turn completed normally (`RUN_FINISHED`), the server logged `[shutdown] SIGINT received, flushing traces...` and exited cleanly, and the just-sent trace was present in Langfuse on the first poll after the flush. No last-turn data loss on shutdown.

**One cosmetic finding, not a failure:** every trace logs a benign SDK warning — `Span attribute langfuse.trace.metadata is not a stringified object. Skipping media handling.` — because `setTraceMetadata` passes a raw object where Langfuse's media scanner expects a pre-stringified value. All metadata fields still record correctly; this is log noise, not a data-integrity issue. Worth a small follow-up fix (`JSON.stringify` before setting the attribute), not urgent.

## Open items

- Revisit Langfuse's ClickHouse-acquisition implications in a few months.
- Fix the cosmetic `langfuse.trace.metadata` stringification warning (see Verification above) when convenient.
- Teardown of the local Docker stack is optional and not yet done — safe to leave up or tear down (`docker compose down`, no `-v`, to preserve trace history) depending on how soon Cycle 2 starts.
- No decision yet on eval/regression tooling (golden-dataset assertions on tool-call sequences) — that's Cycle 2, and now only needs to assert against one transport's event sequences, since there's a single path through the app.
