# @vetta/remote-desktop

Platform-neutral contracts and browser WebRTC orchestration for Vetta screen viewing and remote input.

This package is deliberately separate from `@vetta/remote-control`: desktop media uses WebRTC, input uses the ordered `vetta-input-v1` DataChannel, and the optional reliable `vetta-control-v2` DataChannel carries opaque application text. The application runs the replayable, end-to-end encrypted remote-control protocol over that text channel without exposing its frames to this package.

The host also opens `vetta-view-v1`, on which the phone reports how large it shows the whole screen, in its own pixels with zoom applied (`{"width":1440,"height":900}`). The host uses this size to reduce unnecessary detail, in steps of at most half, and may send a smaller picture under encoder or network load. Older phones close the channel and supply no viewport limit; load adaptation still applies.

Screen capture and sending target at most 30 fps with explicit `maintain-framerate`: Chromium 132 treats
`balanced` screen sharing as `maintain-resolution`. The sender serializes track and parameter changes.
`sampleScreen()` supplies one performance sample and adapts resolution; `watchScreenStream` samples once
per second without overlapping reads and reports diagnostics every five seconds. Moving overload must
persist for two seconds before reducing size, while recovery needs ten seconds of healthy motion and
headroom. Idle low FPS alone never triggers adaptation. Software encoding and viewport limits remain in
effect, and load may shrink the picture further. Lower resolution temporarily softens text. No signaling
or mobile wire-format change is required. See [ADR-0149](../../docs/adr/0149-remote-screen-framerate-adaptation.md).

Sender scaling aligns rounded output to even dimensions for hardware H.264. On Windows with Chromium
132, the Desktop bootstrap also disables `KeepEncoderInstanceOnRelease`: this version can fail while
reconfiguring an existing hardware encoder. The E2E uses the same host configuration and verifies that
a stream starting in hardware remains in hardware across fractional resizing, when hardware is available.

Relay-backed hosts start with `waitForPeerReady: true`. The relay emits the validated, relay-owned `peer_ready` event only after both signaling sockets are online; the host then creates its offer. This prevents the one-shot offer from being lost when the Desktop starts before the mobile viewer.

## Verification

```bash
bun run build
bun run test
bun run test:e2e
```

The E2E launches real Electron Chromium, captures an animated canvas, sends it through an actual `RTCPeerConnection`, checks that the viewer receives nonblank changing pixels, and sends a validated pointer event back through the DataChannel.

It also uses a 1920×1200 moving canvas, injects deterministic load at the statistics boundary, and checks
native downscaling, resolution recovery and at least 24 received fps within the 30 fps budget. It uses a
temporary Chromium profile, not a running Desktop profile. This is not a substitute for physical-device
or real-network performance measurements.
