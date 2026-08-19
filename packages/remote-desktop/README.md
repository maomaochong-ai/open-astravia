# @vetta/remote-desktop

Platform-neutral contracts and browser WebRTC orchestration for Vetta screen viewing and remote input.

This package is deliberately separate from `@vetta/remote-control`: chat/session traffic remains replayable request/event protocol traffic, while desktop media uses WebRTC and input uses an ordered DataChannel.

## Verification

```bash
bun run build
bun run test
bun run test:e2e
```

The E2E launches real Electron Chromium, captures an animated canvas, sends it through an actual `RTCPeerConnection`, checks that the viewer receives nonblank changing pixels, and sends a validated pointer event back through the DataChannel.
