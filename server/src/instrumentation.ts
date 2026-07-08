// OpenTelemetry + Langfuse bootstrap. This must be imported before any agent
// logic runs so the tracer provider is registered before the first span.
//
// Tracing is opt-in: if LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are unset the
// SDK is never started, the Langfuse tracing helpers become no-ops, and the
// agent runs exactly as before. This keeps observability a drop-in, not a hard
// dependency for local development.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

export const tracingEnabled = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
);

export const langfuseSpanProcessor = tracingEnabled
  ? new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3000',
      environment: process.env.NODE_ENV ?? 'development',
    })
  : null;

const sdk = langfuseSpanProcessor
  ? new NodeSDK({ spanProcessors: [langfuseSpanProcessor] })
  : null;

sdk?.start();

if (tracingEnabled) {
  console.log(
    `[tracing] Langfuse enabled -> ${process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3000'}`,
  );
}

/** Flush any buffered spans and shut the SDK down cleanly (called on exit). */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await langfuseSpanProcessor?.forceFlush();
    await sdk.shutdown();
  } catch (err) {
    console.error('[tracing] shutdown error:', err);
  }
}
