# Model runtime contracts and provider routing

`@vetta/ai` owns the stable boundary between a model call and provider-specific transports. Provider adapters may differ in wire protocol, but consumers must not need to know whether the call used OpenAI-compatible, Anthropic, Google, or another transport.

## Decision

- A model call exposes a normalized `ModelCallResult` with the assistant message, unified/raw finish reason, usage, warnings, response metadata, and namespaced provider metadata.
- Model configuration is interpreted as four concerns: model identity (`api`, provider, model id), endpoint (URL and headers), capabilities/limits, and provider compatibility options. Provider selection must use explicit API identity and capabilities; URL detection is only a legacy fallback.
- Cross-cutting model behavior is attached through ordered `ModelMiddleware` at the adapter boundary. Middleware can transform a request or wrap stream/generate execution, but it does not own Agent/Turn state and is not a general mutable event bus.
- `ModelRouter` may choose a fallback only before a stream has emitted model output, and only for explicitly configured structured error codes. Lifecycle-only events such as `start` do not commit a route; the first text, reasoning, tool-call, or successful terminal event does. It never retries or switches providers by parsing human-readable messages.
- Existing `AssistantMessageEventStream`, `stream()` and legacy provider registry remain compatibility projections until all callers use the stable contracts.
- Runtime and Desktop history project the same structured failure contract. The UI receives only an allow-listed diagnostic subset; raw response headers, URLs, and body previews remain logging/provider-bound data.

## Consequences

Provider adapters become independently testable and can add protocol-specific metadata without expanding the shared message type. Usage and cost accounting have one result boundary. Fallback policy is observable and auditable, while partial streams cannot be duplicated into a second provider call. Migration can proceed adapter by adapter without changing session or Agent Step semantics.

Failure handling is also centralized at the adapter invocation boundary: synchronous throws, stream error events, metadata failures, and generate failures are normalized once. The Desktop renderer consumes a small structured projection, so adding a provider does not require a new UI error path or string convention.
