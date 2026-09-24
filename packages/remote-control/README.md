# @vetta/remote-control

Platform-neutral remote control protocol, connection lifecycle, diagnostics contract, and deterministic fake transport.

## Owns

- Versioned remote frames and runtime validation (protocol v2)
- End-to-end encryption: X25519 identity + ephemeral keys, HKDF, XChaCha20-Poly1305 sealed envelopes
- The handshake in both directions (initiator for relay clients and the phone, acceptor for the desktop LAN server), including manual-pairing approval with a six-digit verification code
- Request/response correlation, event sequencing and the outbound event journal that survives a channel switch
- The `vetta://pair` invite link carried by the QR code
- Connection diagnostics without sensitive payload logging
- Fake transport and fake relay for deterministic failure and reconnection tests

## Wire model

Only `hello`, `hello_ack`, `pairing_pending` and `peer_status` travel in clear; a relay reads `hello` to check the role and copies both public keys into the peer's `hello_ack`. Every request, response, event, ack and resume is carried inside a `sealed` frame that neither the relay nor a LAN sniffer can open. An endpoint that receives a plaintext session frame after the handshake closes the link.

## Does not own

- Android or Electron UI
- WebSocket, Cloudflare, process, filesystem, or credential implementations
- Coding Agent execution semantics
- WebRTC screen or input transport; applications may adapt an opaque reliable DataChannel to `RemoteTransport`

The language-neutral v2 contract is published in `schemas/remote-frame.schema.json`. The desktop, the Expo app and the Cloudflare relay all import this package directly; the schema remains as a drift check for any non-TypeScript implementation.

## Development

```bash
bun run build
bun run test
```
