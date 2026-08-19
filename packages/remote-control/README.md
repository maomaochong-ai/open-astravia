# @vetta/remote-control

Platform-neutral remote control protocol, connection lifecycle, diagnostics contract, and deterministic fake transport.

## Owns

- Versioned remote frames and runtime validation
- Request/response correlation and event sequencing
- Connection diagnostics without sensitive payload logging
- Fake transport for deterministic failure and reconnection tests

## Does not own

- Android or Electron UI
- WebSocket, Cloudflare, process, filesystem, or credential implementations
- Coding Agent execution semantics
- WebRTC screen or input transport

The language-neutral v1 contract is published in `schemas/remote-frame.schema.json` so TypeScript, Kotlin, and Worker implementations can detect protocol drift in CI.

## Development

```bash
bun run build
bun run test
```
