# @vetta/runtime-telemetry

Minimal telemetry contract for runtime and host packages.

## What It Owns

- `RuntimeLogger` interface
- `ConsoleRuntimeLogger` default implementation
- structured logger context shape
- platform-neutral `RuntimeTracer` / `RuntimeObservation` interfaces
- `RuntimeObservationPort` adapters for structured logs and flat tracer events
- optional Langfuse exporter in `@vetta/runtime-telemetry/langfuse`

## What It Does Not Own

- metrics pipelines
- business analytics

## Langfuse

```ts
import { createLangfuseRuntimeTracerFromEnv } from "@vetta/runtime-telemetry/langfuse";

const tracer = createLangfuseRuntimeTracerFromEnv();
```

Set `VETTA_TRACING=langfuse` plus Langfuse credentials (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, optional `LANGFUSE_BASE_URL`) to enable it.

## Runtime Observation adapters

```ts
import { RuntimeObservationHub } from "@vetta/runtime-core/observation";
import {
  createRuntimeObservationLoggerPort,
  createRuntimeObservationTracerPort,
} from "@vetta/runtime-telemetry";

const hub = new RuntimeObservationHub();
hub.attach(createRuntimeObservationLoggerPort({ logger }), { id: "log" });
hub.attach(createRuntimeObservationTracerPort({ tracer }), { id: "trace-events" });
```

The tracer adapter records each Runtime Observation as a completed event and delegates `flush()` without owning tracer shutdown.
Native agent/generation/tool span hierarchies remain owned by the execution tracer. Domain payloads are included by default because
the Runtime Observation contract requires producers to publish privacy-safe summaries; set `includePayload: false` for envelope-only
exports.

## Who Depends On It

- runtime and host packages that want a narrow logging abstraction without committing to a full observability stack
