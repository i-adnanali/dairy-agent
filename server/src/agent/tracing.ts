// Thin, OTel-native helpers for the few trace-level attributes Langfuse reads
// from well-known span attribute keys. Deliberately kept close to plain
// OpenTelemetry (raw `setAttribute` on the active span) rather than
// Langfuse-specific decorators, so swapping to another OTel-consuming backend
// later would not require re-instrumenting the agent. Observation-level spans
// (generations, tool calls) use the richer `@langfuse/tracing` API directly.
import { trace } from '@opentelemetry/api';
import { LangfuseOtelSpanAttributes } from '@langfuse/tracing';

/** Group this run's trace under a Langfuse session (here: the AG-UI threadId),
 * so an approval pause and its resume land in the same session. */
export function setTraceSession(sessionId: string): void {
  const span = trace.getActiveSpan();
  span?.setAttribute(LangfuseOtelSpanAttributes.TRACE_SESSION_ID, sessionId);
}

/** Set an optional human-readable name for the trace. */
export function setTraceName(name: string): void {
  const span = trace.getActiveSpan();
  span?.setAttribute(LangfuseOtelSpanAttributes.TRACE_NAME, name);
}

/** Attach custom key/values as trace-level metadata (one attribute per key,
 * matching how the Langfuse SDK flattens metadata). */
export function setTraceMetadata(
  metadata: Record<string, string | number | boolean>,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [key, value] of Object.entries(metadata)) {
    span.setAttribute(`${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`, value);
  }
}
