# @vetta/remote-desktop

Platform-neutral contracts and browser WebRTC orchestration for Vetta screen viewing and remote input.

This package is deliberately separate from `@vetta/remote-control`: chat/session traffic remains replayable request/event protocol traffic, while desktop media uses WebRTC and input uses an ordered DataChannel.

Relay-backed hosts start with `waitForPeerReady: true`. The relay emits the validated, relay-owned `peer_ready` event only after both signaling sockets are online; the host then creates its offer. This prevents the one-shot offer from being lost when the Desktop starts before the mobile viewer.

## Verification

```bash
bun run build
bun run test
bun run test:e2e
```

The E2E launches real Electron Chromium, captures an animated canvas, sends it through an actual `RTCPeerConnection`, checks that the viewer receives nonblank changing pixels, and sends a validated pointer event back through the DataChannel.
