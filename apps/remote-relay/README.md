# Vetta Remote Relay

Cloudflare Worker and Durable Object implementation for relaying the Vetta remote-control protocol between one mobile client and one desktop client.

## Security model

The desktop creates a random pairing identifier and a high-entropy pairing secret. The secret remains in the local pairing link fragment and is sent as a WebSocket subprotocol, rather than being placed in a URL query string. The Worker forwards it only to the owning Durable Object, which stores a SHA-256 hash and compares later connections against that hash. Neither the Worker nor the Durable Object logs secrets or frame payloads.

The first connection for a room must be the desktop. A room expires after 24 hours without active WebSockets. Re-pairing requires a new desktop connection and secret.

The production deployment uses `relay.flowerwine.dpdns.org`. The custom domain is configured in `wrangler.jsonc`; credentials and pairing identifiers are still generated locally by the desktop.

## Routes

- `GET /health` returns relay health metadata.
- `GET /v1/relay/:pairingId/:role` upgrades to WebSocket. `role` is `desktop` or `mobile`.
- `GET /v1/desktop/:pairingId/:role` upgrades the independent WebRTC signaling channel. `role` is `host` or `viewer`.

Clients must offer both protocols:

```text
vetta.remote.v1
vetta.pairing.<base64url-secret>
```

WebRTC signaling uses `vetta.desktop.v1` plus the same pairing protocol. SDP and ICE are validated and forwarded, never logged. Screen pixels and input messages never pass through the Worker.

The relay consumes the `hello` frames to validate the declared role and emits `hello_ack` only after both endpoints complete their handshake. All other valid protocol frames are forwarded unchanged.

## Local verification

```bash
bun run test
bun run typecheck
bun run dev
```

`bun run dev` is intentionally an opt-in local Worker process; it is not started by the repository-wide development command.

Generate a high-entropy local pairing after the Worker is running:

```bash
bun run pair http://127.0.0.1:8787
```

Apply the two printed environment variables to Desktop and paste the printed mobile target into Android. System input remains disabled unless `VETTA_REMOTE_DESKTOP_INPUT_ENABLED=true` is set locally on Desktop.
