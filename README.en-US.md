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

### 🤖 Conversation & Workspace
Message stream, tool-call progress and generated artifacts on one screen. Files preview in-app (PDF, Word, PPT, spreadsheets, images, audio, video, SVG). Scanned PDFs OCR'd offline. Built-in coding-agent reads/writes project files, runs commands and takes screenshots.

### 🗄️ Database Workbench
40+ database engines (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Doris, OceanBase…). SQL workbench with multi-tab queries, history, CSV/JSON export and data editing. The AI queries tables for you. Write operations need graded authorization — `prod` connections are read-only by default. The engine is [dbx](https://github.com/t8y2/dbx) (Apache-2.0), shipped with the app.

### ⚡ Batch Tasks & Scheduling
One prompt across many directories. Built-in cron scheduler, quiet from the tray, with run history and retry.

### 🔔 Notifications & Remote Control
Batch / scheduled completion or failure pushed to Feishu / DingTalk bots (credentials stored encrypted). Remote-control your local agent from Feishu IM (Telegram and DingTalk planned).

### 🌱 Ecosystem
Install skills, MCP servers, plugins and themes from any GitHub repository. Turn local documents into a searchable knowledge base — everything stays on your machine. Plugins must declare capabilities in `plugin.json`, granted individually by the host and re-checked at runtime.

### 🎨 UI Design Workspace
Mockups on an infinite canvas where frames are real, runnable interfaces. One color system across the whole design. Export as render images or read-only share packages.

### 🖥️ Desktop Integration
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

| Scenario | When it happens |
| --- | --- |
| LLM inference | The provider you configured; nothing without a key |
| Model metadata | `models.dev` public catalog; falls back to a bundled snapshot |
| Marketplace | GitHub repos you added; nothing with no sources |
| Automatic updates | Decided by app configuration (electron-updater) |
| MCP / plugins / IM | Decided by extensions and credentials you installed |

**No telemetry. No crash reporting. No usage statistics.**

## Build from Source

Requires **Bun 1.3+** and **Node 20+**:

```bash
bun install
bun run build
bun run build:desktop     # desktop app
bun run build:cli         # optional CLI wrapper
```

IM sidecar (Go, optional): `cd packages/im-gateway && make build`.

## Contributing

```bash
bun run check              # Biome + typecheck + architecture guards (required before a PR)
bun run check:quick        # fast feedback on changed files
bun run test:unit          # core library unit tests
bun run test:changed       # only packages touched by your diff
```

Conventions: **Bun** everywhere; no `any` in TypeScript unless genuinely necessary; all user-facing copy goes through i18n; commit messages in Chinese referencing issues (`fixes #N` / `closes #N`). Full rules in [AGENTS.md](AGENTS.md).

## Architecture

Monorepo with four layers and strictly one-way dependencies: **app → runtime-* → coding-agent / agent / ai**. The core libraries know nothing about the host — the same kernel runs in the Electron desktop app and in a terminal CLI.

```
astravia/
├── packages/
│   ├── ai · agent · coding-agent · ecosystem-adapter   # multi-provider LLM, agent loop, coding agent
│   ├── runtime-core · runtime-tools · runtime-storage  # host-shared adaptation layer
│   │   └── runtime-mcp · runtime-telemetry
│   ├── desktop-app · cli-app · im-gateway              # Electron host, CLI, IM sidecar (Go)
│   ├── ui · theme-ui · theme-sdk
│   ├── plugins · skill-presets · themes
│   └── capability-sdk · capability-runtime
├── docs/   scripts/
```

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
