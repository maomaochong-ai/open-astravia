# Team: Runtime

This package owns the platform-neutral remote control wire contract and connection state machine.

- Production code must not import application packages, Electron, Android, Node I/O, Cloudflare APIs, or Coding Agent product implementations.
- Validate every untrusted frame before it reaches connection state.
- Protocol changes require contract tests for invalid input, ordering, duplicate delivery, timeout, cancellation, and reconnect behavior.
- Logs must contain diagnostic metadata only. Never log credentials, prompts, file contents, or raw payloads.
- Screen streaming and input injection remain outside this package.
