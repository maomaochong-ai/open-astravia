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

## Local observability

`RuntimeTraceRecorder` implements both the native `RuntimeTracer` and the flat `RuntimeObservationPort`.
Inject `write`, `flush`, optional `now`/`createId` and an optional `remote` tracer. The recorder owns the injected
remote tracer shutdown; the host must explicitly call `close()` after producers stop. A Hub does not close its adapters.

`RuntimeTraceRecord` v1 and `parseRuntimeTraceRecord()` define a bounded diagnostic projection: IDs, parent linkage,
timestamps, states, allowlisted metadata, usage and cost. Input, output, status/error messages and arbitrary nested payloads
are excluded even when the execution caller requests content capture. The same projection runs before remote export.

Execution traces are one diagnostic signal within observability, not a separate conversation feature. The existing
Observation Hub routes safe domain events; native execution spans retain their hierarchy and lifecycle through the tracer.

Desktop's runtime composition owns one observability instance, including its repository and recorder. It stores records
in the Agent directory's existing `agent-traces.json` for v1 compatibility, without conversation UI or preload/IPC access.
Its defaults are 7-day retention, 5,000 records and 16 MiB; unreadable/future files are preserved and reported as degraded.
Host-internal queries can filter session, Turn, Trace and failures and use stable pagination cursors. Native Trace scope and configuration
revision are joined from recorded observations, never from mutable live state. See [ADR-0097](../../docs/adr/0097-local-agent-traces.md).

## Consumers

- runtime and host packages that want a narrow logging abstraction without committing to a full observability stack
