<div align="center">
  <img src="docs/assets/banner.png" width="128" alt="Astravia" />
  <h3>Astravia</h3>
  <p><strong>A local-first open-source AI desktop assistant</strong></p>
  <p>Coding · Documents · Data · Automation · Design — one app for all of it</p>
  <p>No cloud · No account · No telemetry — your data and keys never leave your machine</p>
  <p><a href="README.md">简体中文</a> · <b>English</b></p>
</div>

---

<p align="center">
  <img src="docs/assets/screenshot-main.png" alt="Astravia dark theme" width="860" />
</p>

## Quick Start

1. **Download the installer** from [GitHub Releases](https://github.com/maomaochong-ai/astravia/releases) — macOS (Apple Silicon / Intel) or Windows x64
2. **Configure a model**: pick a provider in Settings and enter your own key (Claude, OpenAI, DeepSeek, Kimi, Gemini, Grok, Qwen…)
3. **Start using it**: write code, tidy documents, work on files, query databases, run batch and scheduled tasks

## Features at a Glance

### Conversation & Workspace
Message stream, tool-call progress and generated artifacts on one screen. Files preview in-app (PDF, Word, PPT, spreadsheets, images, audio, video, SVG). Scanned PDFs OCR'd offline. Built-in coding-agent reads/writes project files, runs commands and takes screenshots.

### Database Workbench
40+ database engines (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Doris, OceanBase…). SQL workbench with multi-tab queries, history, CSV/JSON export and data editing. The AI queries tables for you. Write operations need graded authorization — `prod` connections are read-only by default. The engine is [dbx](https://github.com/t8y2/dbx) (Apache-2.0), shipped with the app.

### Batch Tasks & Scheduling
One prompt across many directories. Built-in cron scheduler, quiet from the tray, with run history and retry.

### Notifications & Remote Control
Batch / scheduled completion or failure pushed to Feishu / DingTalk bots (credentials stored encrypted). Remote-control your local agent from Feishu IM (Telegram and DingTalk planned).

### Ecosystem
Install skills, MCP servers, plugins and themes from any GitHub repository. Turn local documents into a searchable knowledge base — everything stays on your machine. Plugins must declare capabilities in `plugin.json`, granted individually by the host and re-checked at runtime.

### UI Design Workspace
Mockups on an infinite canvas where frames are real, runnable interfaces. One color system across the whole design. Export as render images or read-only share packages.

### Desktop Integration
A global hotkey summons the quick panel. On macOS, Appshot captures the frontmost window (screenshot, title, on-screen text) in one gesture. Configure Node / Python runtimes. Tray residency, auto-update, bilingual UI.

## Plugin System

Plugins are not an afterthought — the design canvas, content creation, Git, charts and file previewers are themselves plugins. The same extension points are open to third parties. A plugin can extend the interface (activity tabs, file previews, message cards, shortcuts…) and the agent (system prompts, skills, tools, MCP servers, session entry).

```tsx
import { definePlugin } from "@astravia-org/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    ctx.ui.registerActivityTab({ id: "my-tab", label: "My Panel", component: MyPanel });
  },
});
```

**Bundled plugins**: astravia-ui-design, content-creation, plugin-workbench, git, image-gen, chart-renderer, office-viewer, media-viewer, svg-viewer, astravia-actions.

## Model Configuration

- Preset providers ship with baseUrl and API type only — **no keys at all**: Claude, OpenAI, DeepSeek, Z.ai, Kimi, Gemini, Grok, Qwen
- Once you add your own key, models available to your account sync every 12 hours
- Requests go straight to the provider — never proxied, never billed by the app
- OpenAI-compatible endpoints work too (Ollama / vLLM / LM Studio)
- Pricing and capability metadata from [models.dev](https://models.dev), with a bundled snapshot as fallback

## Network Behavior

The app **never initiates a network call on its own** — every outbound request is triggered by your explicit configuration or action. The table below lists every possible network scenario:

<table width="100%">
<colgroup><col width="15%"><col width="35%"><col width="50%"></colgroup>
<thead><tr><th>Scenario</th><th>When it happens</th><th>What exactly is sent</th></tr></thead>
<tbody>
<tr><td>LLM inference</td><td>You configured a provider and entered your API key in Settings</td><td>Requests go straight to the provider (Claude / OpenAI / DeepSeek / Kimi / Gemini / Grok / Qwen) — the app never proxies, relays or bills you. Nothing happens without a key.</td></tr>
<tr><td>Model metadata</td><td>At startup + every 12 hours in the background</td><td>Pulls pricing and capability metadata from <code>models.dev</code>. If the network fails, falls back to a bundled snapshot — no breakage.</td></tr>
<tr><td>Marketplace</td><td>You added GitHub repos as sources in Settings</td><td>Fetches Releases from the repos you specified, indexes skills / MCP servers / plugins / themes. Nothing happens with zero sources.</td></tr>
<tr><td>Automatic updates</td><td>Update source is decided by app configuration (electron-updater)</td><td>By default checks <code>latest.yml</code> / <code>latest-mac.yml</code> on Cloudflare R2. No update source configured → no checks. Only delta packages are downloaded.</td></tr>
<tr><td>MCP servers</td><td>You installed an MCP server in Settings</td><td>Spawns the process on demand (stdio or HTTP), connects to remote services with your credentials. Nothing happens with no MCP installed.</td></tr>
<tr><td>Plugins</td><td>You installed a third-party plugin in the app</td><td>Plugins can declare their own network behavior (webhooks, API calls etc.), checked at runtime by the host. Bundled plugins make no outbound network calls.</td></tr>
<tr><td>IM remote control</td><td>You enabled a Feishu bot and entered credentials in Settings</td><td>The embedded <code>im-gateway</code> Go sidecar connects to Feishu WebSocket. Nothing happens when disabled. Telegram / DingTalk planned.</td></tr>
<tr><td>OCR models</td><td>One-time download at first install build</td><td>PP-OCRv5 detection + recognition models (~100MB) are downloaded to <code>resources/ocr-models</code> and then run fully offline.</td></tr>
<tr><td>Build-time downloads</td><td>Running <code>bun run build</code> during development</td><td>Portable Python / Node.js runtimes from <code>python-build-standalone</code>; the dbx database engine binary from GitHub Releases.</td></tr>
</tbody>
</table>

**No telemetry. No crash reporting. No usage statistics. Any outbound request always comes from the provider you configured, the extensions you installed, or the download you triggered.**

## How to Develop

### Prerequisites

- **Bun 1.3+** (package manager — the monorepo uses Bun everywhere; npm / pnpm are not accepted)
- **Node 20+** (needed for Vite builds)
- **Go 1.22+** (only required for building `im-gateway`, optional)
- macOS or Windows desktop (only required for building `desktop-app`, optional)

### One-time Setup

```bash
# 1. Clone
git clone git@github.com:maomaochong-ai/astravia.git
cd astravia

# 2. Install all dependencies (monorepo workspaces handled automatically)
bun install

# 3. (Optional) Build native modules required by the desktop app
bun run build:desktop
```

### Daily Development

```bash
# Desktop app dev mode (hot reload + DevTools)
bun run dev

# Terminal CLI dev mode
bun run dev:cli

# Run unit tests for one package only
bun run test:pkg ai          # test:pkg --list to see all packages
```

### Before Submitting

```bash
# Full quality gate (required before opening a PR; blocks commit on failure)
bun run check
#   Includes: Biome lint + TypeScript typecheck + architecture guard (one-way deps)
#             + secret key detection + conflict marker detection

# Fast feedback on changed files (saves time)
bun run check:quick

# Only unit-test packages touched by your diff
bun run test:changed
```

### Commit Conventions

- **Bun everywhere for package management**: no `package-lock.json` / `pnpm-lock.yaml`
- **No unnecessary `any` in TypeScript**: must fix all type errors to pass `check`
- **User-facing copy must go through i18n**: hard-coding Chinese / English strings in components is a violation
- **Commit messages in Chinese**, referencing issues (`fixes #N` / `closes #N`). Prefix with `feat:` / `fix:` / `docs:` / `refactor:` / `chore:`
- Full rules in [AGENTS.md](AGENTS.md)

### Optional Module Builds

```bash
# CLI wrapper
bun run build:cli

# IM sidecar (Go, independent Makefile)
cd packages/im-gateway && make build

# OCR models (auto-downloaded on first build)
bun run prepare:ocr-models
```

## Architecture

Monorepo. **Dependencies flow strictly downward**: host apps → runtime adapters → AI/agent kernel. Core libraries have no awareness of the host — the same kernel runs in the Electron desktop app and in a terminal CLI.

```
astravia/
├── packages/
│   ├── ai                     — Multi-provider LLM adapters (Claude / OpenAI / DeepSeek / Kimi / ...)
│   ├── agent                  — Agent loop, session management, tool dispatch
│   ├── coding-agent           — Coding agent: reads/writes project files, runs commands, takes screenshots
│   ├── ecosystem-adapter      — Runtime adapter for marketplace, plugins and skills
│   ├── runtime-core           — Host-shared adapter layer: config dir, credential store, event bus
│   ├── runtime-tools          — Host-shared adapter layer: filesystem, command execution, network
│   ├── runtime-storage        — Host-shared adapter layer: session persistence, workspace index
│   ├── runtime-mcp            — MCP server lifecycle management
│   ├── runtime-telemetry      — Telemetry (disk-only, never sent)
│   ├── desktop-app            — Electron desktop host (macOS / Windows native signed)
│   ├── cli-app                — Terminal CLI host
│   ├── im-gateway             — Go IM sidecar (Feishu, starts and stops with the app)
│   ├── ui                     — React component primitives
│   ├── theme-ui               — Themed UI components
│   ├── theme-sdk              — Theme SDK (color tokens, component override points)
│   ├── plugins                — Bundled plugins (UI design, content creation, Git, charts, preview…)
│   ├── skill-presets          — Bundled skill presets
│   ├── themes                 — Bundled themes
│   ├── capability-sdk         — Capability and permission definition SDK
│   ├── capability-runtime     — Capability runtime (permission checks, capability orchestration)
│   ├── action-rpc             — Agent ↔ Desktop RPC protocol
│   └── toolkit                — Dev utilities
├── docs/                      — Architecture docs and ADRs
└── scripts/                   — Build, release and quality guards
```

**Dependency direction**:
- `desktop-app` / `cli-app` → `runtime-*` → `coding-agent` / `agent` / `ai`
- `ai` ← `agent` ← `coding-agent` (Agent holds LLM calling capability)
- `runtime-*` has no dependency on the AI layer; `capability-*` spans layers for permission definitions
- `plugins` / `skill-presets` / `themes` are pure resource bundles with no runtime dependency

## Join the Community

<div align="center">
  <table>
    <tr>
      <td align="center"><img src="docs/assets/community/qq-group.png" width="220" alt="QQ group" /><p>QQ Group</p></td>
      <td align="center"><img src="docs/assets/community/wechat-group.png" width="220" alt="WeChat group" /><p>WeChat Group</p></td>
    </tr>
  </table>
  <p>Scan the QR code to join, share feedback, ask questions and get the latest updates.</p>
</div>

## Credits

| Project | Used for | License |
| --- | --- | --- |
| pi · Mario Zechner | `ai`, `agent`, `coding-agent`, `ecosystem-adapter` were rewritten and iterated on top of it | MIT |
| Codex CLI · OpenAI | Execution sandbox design draws on theirs | Apache-2.0 |
| bubblewrap | Linux sandbox backend | LGPL-2.0+ |
| PP-OCRv5 · PaddlePaddle | Offline PDF OCR | Apache-2.0 |
| dbx | Database engine | Apache-2.0 |
| python-build-standalone / Node.js | Portable runtimes | See upstream |

Thanks also to the [Model Context Protocol](https://modelcontextprotocol.io) specification and [models.dev](https://models.dev). Full third-party inventory in [NOTICE](NOTICE).

## License

[Apache-2.0](LICENSE)
