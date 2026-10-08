# @vetta/remote-desktop

Platform-neutral contracts and browser WebRTC orchestration for Vetta screen viewing and remote input.

This package is deliberately separate from `@vetta/remote-control`: desktop media uses WebRTC, input uses the ordered `vetta-input-v1` DataChannel, and the optional reliable `vetta-control-v2` DataChannel carries opaque application text. The application runs the replayable, end-to-end encrypted remote-control protocol over that text channel without exposing its frames to this package.

The host also opens `vetta-view-v1`, on which the phone reports how large it shows the whole screen, in its own pixels with zoom applied (`{"width":1440,"height":900}`). The host sends the screen no larger than that, in steps of at most half, and smaller still while Chromium encodes in software. Older phones close the channel and keep the full size.

Relay-backed hosts start with `waitForPeerReady: true`. The relay emits the validated, relay-owned `peer_ready` event only after both signaling sockets are online; the host then creates its offer. This prevents the one-shot offer from being lost when the Desktop starts before the mobile viewer.

## Verification

```bash
bun run build
bun run test
bun run test:e2e
```

The E2E launches real Electron Chromium, captures an animated canvas, sends it through an actual `RTCPeerConnection`, checks that the viewer receives nonblank changing pixels, and sends a validated pointer event back through the DataChannel.
