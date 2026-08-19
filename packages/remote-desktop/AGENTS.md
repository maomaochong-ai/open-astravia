# Remote Desktop Agent Guide

This package owns the platform-neutral WebRTC signaling, browser peer orchestration, and remote input DataChannel contract.

- It must not import Electron, Android, Cloudflare, Node native APIs, or chat/session protocol modules.
- Screen media and input injection are host-provided adapters. Never implement OS permission bypasses here.
- Validate every signaling and input message at the first boundary. Reject unknown fields that could expand authority.
- Logs and diagnostics may contain session IDs, state, dimensions, codec names, counts, and timing only. Never log SDP, ICE candidates, key text, clipboard data, or captured pixels.
- A remote-control grant is scoped to one peer session and must be explicitly revocable by the host.
- WebRTC E2E must verify nonblank moving pixels and a real DataChannel input round trip in Chromium.
