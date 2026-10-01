# cowart-astravia (1:1 host mapping)

Astravia external plugin adapted from [zhongerxin/Cowart](https://github.com/zhongerxin/Cowart).

## This is NOT a system plugin

It lives under `packages/plugins/externals/` (not `presets/`), so it ships as a
**user-installable** plugin: build the zip, install it in Desktop, grant the
declared permissions, and enable/disable or remove it like other external plugins.

## Capability map (Codex → Astravia)

| Codex native | Astravia native |
|--------------|--------------|
| MCP App widget (`ui://widget/...`) | Activity tab + full **tldraw** `canvas/App.jsx` |
| `window.cowartMcp.callServerTool` | Plugin bridge → `ctx.fs` (same `project/canvas` layout) |
| `sendFollowUpMessage` | `ctx.conversation.sendPrompt` |
| Plugin-scoped MCP tools | `agent.mcpServers` + ADR-0040 (agent IO) |
| Skills | `agent.skillPaths` + slash list |

## Layout

```text
src/                 # definePlugin, CanvasPanel, astravia bridge
canvas/              # upstream App.jsx + styles/assets (tldraw UI)
mcp/ + scripts/      # agent MCP (stdio), Astravia-safe bundle
agent/skills/        # open / image-gen / image-edit
.mcp.json
plugin.json
```

## Build

```bash
cd packages/plugins/externals/cowart-astravia
bun install --cwd ../..
bun run build
```

The installable archive is written to:

```text
packages/plugins/externals/cowart-astravia/release/cowart-astravia-<version>.astraviapkg
```

Install the zip from Desktop → Plugins, **restart App** if needed, open a **new conversation**.

## MCP start-mcp note

Do not `process.exit` after loading the server — `connect()` resolves when ready but the process must stay on stdio.

## Attribution

Upstream Cowart by ZHONG XIN. Astravia host adaptation for internal use.
