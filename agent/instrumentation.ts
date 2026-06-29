import { defineInstrumentation } from "eve/instrumentation";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Register a global OpenTelemetry tracer provider so Eve/AI-SDK telemetry spans
// (model calls, tool calls, durations, token usage) export to a collector.
// Gated on OTEL_EXPORTER_OTLP_ENDPOINT: only starts when you've pointed it at a
// collector (e.g. the Jaeger service in docker-compose.yml), so a normal run
// without Jaeger doesn't spew connection-refused errors.
//
//   docker compose up -d jaeger      # UI http://localhost:16686
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev
function startOtelExport(serviceName: string): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, "")}/v1/traces` }),
  });
  sdk.start();
  // Flush buffered spans on shutdown so short-lived runs (evals) don't drop them.
  const stop = () => void sdk.shutdown().catch(() => {});
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("beforeExit", stop);
  // eslint-disable-next-line no-console
  console.error(`[instrument] OTel export -> ${endpoint} (service=${serviceName})`);
}

// Auto-discovered by Eve at startup; its mere presence enables telemetry spans
// around model calls. We add a `step.started` hook purely for HANG DIAGNOSIS:
// it fires right before each model-call attempt, so the stderr marker below is
// the last thing printed before the agent blocks on the LLM fetch. If you see
// "step.started" with no matching model response in the debug log, the turn is
// stalled in the model call (hosted provider / network), not in the sandbox.
//
// Pair with: EVE_LOG_LEVEL=debug pnpm eval ... 2>&1 | tee eve-debug.log
//
// recordInputs/recordOutputs default to true when this file exists; kept
// explicit so it's obvious full prompts/outputs land in the spans.
export default defineInstrumentation({
  recordInputs: true,
  recordOutputs: true,
  // Runs at server startup with the resolved agent name; wires the OTel export.
  setup: ({ agentName }) => startOtelExport(agentName),
  events: {
    "step.started": ({ turn, step, modelInput, session }) => {
      const last = modelInput.messages.at(-1);
      // eslint-disable-next-line no-console
      console.error(
        `[instrument] step.started ts=${new Date().toISOString()} ` +
          `session=${session.id} turn=${turn.id} seq=${turn.sequence} step=${step.index} ` +
          `messages=${modelInput.messages.length} lastRole=${last?.role ?? "<none>"}`,
      );
      return undefined;
    },
  },
});
