# Vetta Remote Relay

Cloudflare Worker and Durable Object implementation for relaying the Vetta remote-control protocol (v2) between one desktop and one paired phone. The relay is the cloud fallback; when both devices share a network the phone connects to the desktop's LAN server directly and the relay only holds an idle, hibernated desktop connection.

## Security model

- **One room per paired phone.** The desktop generates a pairing id, its own secret and the phone's secret. The phone receives its secret through the QR code (or a sealed `device.paired` event after a manual approval). The desktop registers the room first, offering its secret and the SHA-256 of the phone's secret; the Worker hashes the desktop secret too, so the Durable Object stores only two digests and can never present either secret.
- **Secrets travel as WebSocket subprotocols**, never in URLs. Nothing about the offer is logged.
- **The relay cannot read session traffic.** After each side's plaintext `hello` the room copies the two public keys (identity and ephemeral X25519) into the other side's `hello_ack` and from then on forwards only `sealed` envelopes. Encryption is end to end (`@vetta/remote-control`); a plaintext session frame after the handshake closes the socket with code 4002.
- **Re-registration is desktop-owned.** A desktop that reconnects with its own secret may replace the stored phone hash (room expiry, rotated credential); a phone can only join a room the desktop already registered.
- A room expires after 24 hours without any socket. The desktop re-registers on its next connection.

## Routes

- `GET /health` returns `{ status, protocolVersion: 2 }`.
- `GET /v2/relay/:pairingId/:role` upgrades the control WebSocket. `role` is `desktop` or `mobile`.
- `GET /v2/desktop/:pairingId/:role` upgrades the independent WebRTC signaling channel. `role` is `host` or `viewer`; the pair room vouches for the credential, so the desktop must have registered the room over the control route first.

Control clients offer:

```text
vetta.remote.v2
vetta.pairing.<base64url-secret>
vetta.peer.<sha256-hex-of-phone-secret>    # desktop only
```

The Worker answers with `vetta.remote.v2`. WebRTC signaling uses `vetta.desktop.v1` plus the `vetta.pairing.*` protocol. SDP and ICE are validated and forwarded, never logged; screen pixels and input never pass through the Worker.

## Framing

1. First frame on each socket must be a v2 `hello` whose role matches the route.
2. When both sides are authenticated the room sends each a `hello_ack` carrying the peer's `deviceId`, `identityKey` and `ephemeralKey`. It does so again every time a new `hello` completes, so a reconnecting phone re-keys the parked desktop.
3. Everything afterwards must be `sealed`. A sealed frame sent while the peer is absent is answered with `peer_status { online: false }`; the sender is not closed.
4. When a side disconnects the remaining side receives `peer_status { online: false }` and stays connected.

## Free plan

Both rooms answer the text `ping` with `pong` through `setWebSocketAutoResponse`, so keepalives never wake a hibernated object and idle pairs accrue no billable duration. The Worker performs one SHA-256 per upgrade and no storage writes on the forwarding path.

## Local verification

```bash
bun run test
bun run typecheck
bun run dev
```

`bun run dev` is intentionally an opt-in local Worker process; it is not started by the repository-wide development command. `bun run pair http://127.0.0.1:8787` prints hand-crafted v2 pairing material (URLs, subprotocols and the desktop's expected peer hash) for exercising a local relay without the desktop app.
