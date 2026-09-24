# Team: Runtime

This package owns the platform-neutral remote control wire contract and connection state machine.

- Production code must not import application packages, Electron, Android, Node I/O, Cloudflare APIs, or Coding Agent product implementations.
- Validate every untrusted frame before it reaches connection state.
- Protocol changes require contract tests for invalid input, ordering, duplicate delivery, timeout, cancellation, and reconnect behavior.
- Logs must contain diagnostic metadata only. Never log credentials, prompts, file contents, or raw payloads.
- Screen streaming and input injection remain outside this package.
- Cryptography stays on the audited `@noble/*` primitives already used here; do not add a second cipher suite or hand-rolled key schedules. Key material never appears in logs, snapshots or error messages.
- Any frame type that may travel in clear must be listed in `RemoteHandshakeFrame`; everything else must be rejected outside a `sealed` envelope.
