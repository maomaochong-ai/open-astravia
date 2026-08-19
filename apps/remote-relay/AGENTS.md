# Remote Relay Agent Guide

This application owns the Cloudflare Worker and Durable Object relay implementation.

- Keep it a transport boundary: validate every frame with `@vetta/remote-control`, but never interpret prompt, file, terminal, screen, or input payloads.
- Pairing credentials are secrets. Never include them in URLs, logs, Durable Object attachments, errors, or test snapshots.
- Durable Object hibernation means in-memory state cannot be required for routing. Persist room authorization state and use small WebSocket attachments for connection metadata.
- Do not add a Cloudflare deployment, secret, route, account configuration, or production test without explicit user approval.
- Test all externally observable routes with the Workers Vitest pool. Include unauthorized and malformed-input cases whenever routing or authentication changes.
