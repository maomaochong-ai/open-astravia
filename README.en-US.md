<p align="center">
  <img src="docs/assets/banner.webp" alt="Open Astravia">
</p>

<h1 align="center">Open Astravia</h1>

<p align="center">
  An open-source AI agent built for real work — local, extensible, and under your control.
</p>

<p align="center">
  <a href="https://www.openastravia.com"><img src="https://img.shields.io/badge/website-openastravia.com-0b7285" alt="Website"></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/runtime-Bun%201.3%2B-black" alt="Bun">
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.md">简体中文</a> ·
  <a href="https://www.openastravia.com">Website</a> ·
  <a href="https://www.openastravia.com/download">Download</a>
</p>

---

## What This Is

Your local-first AI agent for real work.
Open Astravia is an open-source desktop AI agent for coding, documents, data, workflows, and creative tasks. Bring your own models and tools through BYOK, MCP, skills, and plugins — with your data kept under your control.

Designed for professional and coding workflows, it helps individuals and teams build AI agents
that are customizable, extensible, and under their control. Whether you are working with
documents, analyzing data, writing code, building workflows, or connecting your own models,
tools, and knowledge, Open Astravia is designed to participate in real work and deliver results.

Open Astravia runs in the environment you choose. Connect your own models, tools, and data, and use
or extend its agent core through the desktop app, CLI, and SDK.

We chose open source because the future of AI-powered work should not be defined by only a few.
Developers, creators, and real users can contribute code, develop skills, integrate new models
and tools, and shape an agent around the way they actually work.

### Your Data, Under Your Control

Open Astravia does not depend on a Astravia-operated backend: there is no login, account, subscription
billing, or remote admin console. You bring your own API keys; requests go directly to the model
provider you choose, and keys stay in your local keychain. Open Astravia collects no telemetry,
crash reports, or usage analytics. Every outbound request is explicitly triggered by your own
configuration (see [Network Behavior](#network-behavior)).

<p align="center">
  <img src="docs/assets/screenshot.png" alt="Open Astravia desktop app">
</p>

---

## Desktop Features

An index of what's there and how to use it. Full guides live on the [website](https://www.openastravia.com).

### Conversation & Workspace

| Feature | What it does |
|---------|--------------|
| Chat | The main surface: message stream, artifact rendering, visible tool calls, auto-follow and jump-to-bottom. |
| Projects & sessions | Sessions organized by project in the sidebar. Projects come in three kinds — regular, batch, and scheduled — each with its own execution shape. |
| File browser & preview | Built-in local file tree. PDFs, Office documents, spreadsheets, images, audio and video preview in-app; scanned PDFs can be OCR'd offline. |
| Activity panel | A resizable side panel showing tool calls, request history, batch progress and debug output in real time. |
| Execution isolation | Pick an isolation level per session to constrain which directories the agent can touch and whether it may reach the network, with stray processes reaped on exit. Backed by system-level isolation on all three platforms. |

### Automation

| Feature | What it does |
|---------|--------------|
| Batch tasks | One prompt across many target directories, run in parallel at a concurrency you set, with pause, per-item retry, and full rerun. |
| Scheduling | Set a cron expression and tasks fire on time. Leave the app in the tray; you don't have to sit there. |
| Webhook notifications | Push completions and failures to Feishu or DingTalk bots. Credentials are stored encrypted, locally. |
| IM bridge | Once credentials are set, hand work to the agent on your machine from IM on your phone and get results back — useful when you're away from the desk. Feishu today; early stage. |

### Extensions

| Feature | What it does |
|---------|--------------|
| Marketplace | Browse and install skills, MCP servers, plugins and bundles. A marketplace source is just a GitHub repository — add as many as you like, or none at all. There is no central server. |
| Skills | Turn a way of working into something reusable. A set ships built in; more can be installed from a marketplace. |
| MCP | Full MCP server support. Once connected, the tools are automatically visible to the agent. |
| Plugins | Most of the app's workspace surfaces are plugins, and can be enabled or removed as you like. See [Plugin System](#plugin-system). |
| Themes | The entire look of the app is replaceable, including third-party themes. |

### Local Data

| Feature | What it does |
|---------|--------------|
| Knowledge base | Put local documents into a knowledge base; the app organizes them in the background into something searchable that the agent can draw on. Nothing leaves your machine. |

### Native Desktop Integration

| Feature | What it does |
|---------|--------------|
| Quick panel | A global hotkey brings up an input panel from anywhere, so you can start a task without switching windows. |
| Appshot (macOS) | One gesture captures the frontmost window along with the text on screen and hands both to the agent — no screenshotting and then describing it again. |
| Desktop pet | A desktop mascot that reacts to session state. Can be hidden. |
| Runtime management | When Node or Python is needed, the app provisions it — without polluting your system environment or requiring you to install anything first. |
| Setup wizard | Walks you through model configuration, permissions, and runtime preparation on first launch. |
| System integration | Tray residency, customizable shortcuts, native notifications, automatic updates. |
| Bilingual UI | Full English and Chinese coverage, switchable at any time. |

---

## Plugin System

Plugins aren't decoration around the edges. The design canvas, the content workspace, Git,
charts, the various file previewers — those surfaces are plugins. The same extension points
are fully open to third parties.

A plugin is a React package that registers contributions in `activate(ctx)`, or declares them
in `plugin.json`. It can extend the interface, and it can extend what the agent is capable of.

### Design Stance

**A plugin is part of Astravia, not a bolt-on beside it.**
Plugins in most agent tools stop at "add a few tools, a few commands, a few MCP servers" —
the capability is attached from outside and the product is still the same product.
A Astravia plugin can inject system prompts, skills, tools and MCP servers into the agent,
declare which work modes it applies to, take over the entry point of a new session, and decide
whether a turn continues automatically. Install a set of plugins and you don't get "Astravia with
extra buttons" — you get Astravia rearranged around how you actually work.

**The interface and the conversation run both ways.**
A plugin doesn't only give the model new abilities; it can drive the conversation back.
Select an element on the canvas, click an item in the file tree, and a turn starts carrying
exactly that context. That return path — from interface back into the session — isn't something
a CLI-shaped extension mechanism can offer.

**Bundled features and third-party plugins use the same API.**
The preinstalled plugins in this repository are built on the public extension points documented
here. There are no private backdoors. System plugins differ from ordinary ones only in how they
ship — bundled with the app, permissions granted automatically, not removable — never in what
they're allowed to do. What you can build is the same kind of thing we build.

**Astravia writes plugins.**
The plugin workbench packages this developer handbook and a checklist into a skill, hands it
to the agent with a dedicated work-mode prompt, and hard-isolates those contributions inside
workbench mode so they never leak into everyday sessions. So going from "I want a panel that
does X" to having it installed can happen entirely in conversation — and the handbook Astravia
reads while building it is the one you're about to read.

### Extension Points

**Interface**

| Extension point | What you can do |
|-----------------|-----------------|
| Activity tab | Open your own workspace in the activity panel — the most common landing spot for a plugin |
| Global overlay | Mount overlay UI across the whole app |
| File preview | Take over rendering for a file type, with streamed URLs for large files |
| File explorer | Add context menus, toolbar buttons and status decorations to the file tree; reveal and refresh |
| Message cards | Register custom card renderers for structured agent output, with cross-turn deduplication |
| Tool call rendering | Replace how a given tool call appears inline in the message stream |
| Turn card | Pin a persistent card above the current turn |
| Input action | Add a toggle-style action to the composer |
| Notifications | Raise toasts and error notices — no permission required |
| Shortcut scopes | Plug into the host's shortcut scope stack without fighting global bindings |

**Conversation & agent**

| Extension point | What you can do |
|-----------------|-----------------|
| Read the conversation | Subscribe to session state and the event stream |
| Drive the conversation | Send prompts, insert text, abort the current run on the user's behalf |
| Register agent tools | Expose plugin capability as a tool the model can call |
| Register app actions | Contribute app-level actions with a JSON Schema, approval flow and cancellation |
| Ship skills | Distribute skills with the plugin; they take effect on install |
| Bundled MCP servers | Ship an MCP server inside the plugin, aggregated alongside the user's own |
| Dynamic system prompts | Inject a system prompt into the turn based on context |
| Continuation strategy | Decide whether a turn continues automatically once it ends |
| Guiding words | Offer entry points in an empty session |
| Work-mode gating | Declare which work modes the plugin applies to, and react when the mode changes |

**System capabilities**

| Extension point | What you can do |
|-----------------|-----------------|
| Filesystem | Read and write workspace files |
| Commands | Run one-off commands, or spawn long-lived processes such as your own dev server |
| Network | Make requests through the host, sidestepping renderer CORS constraints |
| Private storage | Persistent storage scoped to the plugin |
| Settings | Declare and read your own settings; the host renders the settings UI |
| Plugin i18n | Ship locale catalogs that follow the app's language |

### Permission Model

Every capability must be declared explicitly in `plugin.json`, granted individually by the host,
and checked again at runtime; anything undeclared is denied. Plugins share a single React runtime
with the host, which means they are positioned as **reviewed first-party / curated extensions**
rather than a sandbox for arbitrary untrusted code. That tradeoff and its boundaries are spelled
out in [permissions.md](docs/plugin/permissions.md).

### Getting Started

```tsx
import { definePlugin } from "@astravia-org/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    ctx.ui.registerActivityTab({ id: "my-tab", label: "My Panel", component: MyPanel });
  },
});
```

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "pluginApiVersion": "^1.0.0",
  "permissions": ["ui.slot.activity-tab"]
}
```

Rather not hand-write scaffolding? Use the
[plugin workbench](packages/plugins/presets/plugin-workbench) — describe the panel you want
in conversation, let Astravia create it, build it, and install it locally.

### Developer Handbook

| Document | Contents |
|----------|----------|
| [getting-started.md](docs/plugin/getting-started.md) | Environment, scaffolding, building, installing, debug loop |
| [manifest.md](docs/plugin/manifest.md) | Every `plugin.json` field, work-mode allowlist, i18n, settings, agent-side contributions |
| [permissions.md](docs/plugin/permissions.md) | Full permission list, gating points, declaration and grant flow |
| [ui-slots.md](docs/plugin/ui-slots.md) | Global overlays, activity tabs, file preview, input actions, turn cards, tool slots, shortcuts |
| [message-cards.md](docs/plugin/message-cards.md) | Card renderers and cross-turn deduplication |
| [file-explorer.md](docs/plugin/file-explorer.md) | Context menus, toolbars, decorations, reveal and events |
| [conversation-and-agent.md](docs/plugin/conversation-and-agent.md) | Conversation read/write, tool registration, commands, fs, network, storage, settings, i18n |
| [app-actions.md](docs/plugin/app-actions.md) | App action schemas, approval, lifecycle, independent releases |
| [mcp.md](docs/plugin/mcp.md) | Three-source MCP aggregation and plugin-bundled MCP |
| [system-plugins.md](docs/plugin/system-plugins.md) | System plugins (presets) and tenant packaging |
| [styling-and-pitfalls.md](docs/plugin/styling-and-pitfalls.md) | Styling conventions, common pitfalls, caching and versioning |

Full index at [docs/plugin/README.md](docs/plugin/README.md);
the SDK and build tooling live in [packages/plugins](packages/plugins).

### Bundled Plugins

| Plugin | Description |
|--------|-------------|
| [astravia-ui-design](packages/plugins/presets/astravia-ui-design) | Infinite-canvas UI design workspace — see below |
| [content-creation](packages/plugins/presets/content-creation) | Node canvas, asset production and multi-track composition |
| [plugin-workbench](packages/plugins/presets/plugin-workbench) | Build plugins by conversation, from creation to installation, all in-app |
| [git](packages/plugins/presets/git) | Git status tree and file diffs in the activity panel |
| [image-gen](packages/plugins/presets/image-gen) | Image generation |
| [chart-renderer](packages/plugins/presets/chart-renderer) | Render agent-produced data as charts inline in the conversation |
| [office-viewer](packages/plugins/presets/office-viewer) · [media-viewer](packages/plugins/presets/media-viewer) · [svg-viewer](packages/plugins/presets/svg-viewer) | Offline preview for PDF/DOCX/PPTX/spreadsheets, images and media, and SVG |
| [astravia-actions](packages/plugins/presets/astravia-actions) | A set of official built-in actions the agent can call directly |

A few more plugins under `packages/plugins/externals` (Cowart infinite canvas, mobile device UI
preview, and others) are **not bundled with the app** — they exist as source examples and
reference material for writing your own.

### Astravia UI Design

Design UI on an infinite canvas. A frame isn't a static layer — it's a real, running,
interactive interface, and what you see is what it is.

- Create a design document from the "Design" tab in the activity panel, or just ask Astravia
  to make one in conversation.
- Select a frame, several frames, or one specific element inside a frame, hit "ask Astravia"
  and say what you want changed. The canvas updates live — no explaining which button you meant.
- One shared color system across the whole document; change it once and every frame follows.
- Export frames as rendered images with adjustable corner radius, border, shadow, background
  and output scale, or copy straight to the clipboard.
- Package an entire design as a read-only share bundle that opens in-app on the other end,
  with nothing to set up.

The design runtime is provisioned automatically on first use — no need to install Node or
configure anything.

<p align="center">
  <img src="docs/assets/ui-design-canvas.png" alt="Conversation on the left, a design taking shape on the infinite canvas on the right">
</p>

<p align="center">
  <sub>Ask once and Astravia builds the page: conversation and outputs on the left, canvas on the right — select any frame or element to keep refining</sub>
</p>

<p align="center">
  <img src="docs/assets/ui-design-export.png" alt="Exported render: three mobile frames laid out on a brand-colour background">
</p>

<p align="center">
  <sub>Select frames and export a render — background, corner radius, shadow and branding are all adjustable, ready to hand off or share</sub>
</p>

---

## Installation

### Download

Grab macOS, Windows and Linux installers from [Releases](../../releases). All three platforms
are built and published by `.github/workflows/desktop-release.yml`.

### Build from Source

Requires **Bun 1.3+** and **Node 20+**.

```bash
bun install                # install all workspace dependencies
bun run build              # build the core libraries
bun run build:desktop      # build the desktop app
bun run build:cli          # build the CLI app
```

The IM bridge gateway (Go):

```bash
cd packages/im-gateway && make build
```

---

## Architecture

The monorepo has four layers, with dependencies pointing one way:
**apps → runtime-\* → coding-agent / agent / ai**. The core libraries know nothing about
their host, which is why the same core runs inside Electron and in a terminal alike.

### Apps

| Package | Role | Stack |
|---------|------|-------|
| [desktop-app](packages/desktop-app) | Electron desktop host, home to everything above | Electron · React · Vite · Jotai · TanStack Router · shadcn/ui · Tailwind v4 |
| [coding-agent](packages/coding-agent) | Coding agent core, with interactive / print-JSON / RPC / SDK modes | TypeScript |
| [cli-app](packages/cli-app) | A pure CLI wrapper around coding-agent | TypeScript |
| [im-gateway](packages/im-gateway) | IM bridge sidecar, talking to the desktop main process over NDJSON IPC | Go |

### Core Libraries

| Package | Owns | Does not own |
|---------|------|--------------|
| [ai](packages/ai) | Multi-provider LLM API, model registry, provider adapters, token and cost accounting | Agent loop, UI, session persistence |
| [agent](packages/agent) | Stateful agent loop, tool calls, event stream | Terminal/desktop UI, business rules |
| [ui](packages/ui) · [theme-ui](packages/theme-ui) · [theme-sdk](packages/theme-sdk) | Reusable UI primitives, theme view layer and theme SDK | Host lifecycle |

### Runtime Layer

Adapter packages shared by host apps: [runtime-core](packages/runtime-core) (`RuntimeHost` and
the session facade), [runtime-tools](packages/runtime-tools) (built-in tool re-exports),
[runtime-storage](packages/runtime-storage) (session and settings storage),
[runtime-mcp](packages/runtime-mcp) (MCP manager bindings), and
[runtime-telemetry](packages/runtime-telemetry) (local logging abstraction — disk only).

### Layout

```
open-astravia-mono/
├── packages/
│   ├── ai · agent · ui · theme-ui · theme-sdk      # core libraries
│   ├── runtime-core · runtime-tools · runtime-mcp · runtime-storage · runtime-telemetry
│   ├── coding-agent · cli-app · desktop-app        # apps
│   ├── im-gateway                                  # IM bridge (Go)
│   ├── plugins · themes · skill-presets            # extension ecosystem
│   └── capability-sdk · capability-runtime         # capability and permission layer
├── docs/                                           # architecture docs and ADRs
├── scripts/                                        # build, release and quality guards
├── AGENTS.md                                       # development and AI collaboration rules
└── CONTEXT.md                                      # domain glossary
```

---

## Model Configuration (BYOK)

The client ships a preset provider catalog (Claude, OpenAI, DeepSeek, Z.ai (GLM), Kimi, Gemini,
Grok, Qwen) containing **only `baseUrl` and API type — no keys**. Once you add your own key:

- it immediately queries that provider's `/models` for what your account can actually use,
  then re-syncs in the background every 12 hours;
- pricing and capability metadata are filled in from the public [models.dev](https://models.dev)
  catalog, with a bundled snapshot as fallback;
- requests go straight to the provider. This app does not proxy, relay, or bill.

Any OpenAI-compatible endpoint works too, including local inference via Ollama, vLLM or LM Studio.
Background in [ADR-0050](docs/adr/0050-preset-providers-move-client-side-with-dynamic-model-lists.md).

---

## Marketplace

Capabilities — skills, MCP servers, plugins and bundles — come from **GitHub repository archives**:
the client downloads the repo tarball, reads `.astravia/marketplace.json` inside it, and does all
searching and filtering against the local snapshot. Add as many sources as you like, or none.

Manifest format in [docs/open-marketplace.md](docs/open-marketplace.md); the unified model is
described in [ADR-0049](docs/adr/0049-abilities-unify-storage-and-presentation-not-installation.md).

MCP configuration example:

```jsonc
// ~/.astravia/agent/mcp.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
    }
  }
}
```

Use `/mcp` in interactive mode to check status. Details in
[packages/coding-agent/docs/MCP.md](packages/coding-agent/docs/MCP.md).

---

## Network Behavior

The app makes network requests only in the following cases, all of them driven by your configuration:

| Purpose | Destination | Can it be turned off |
|---------|-------------|----------------------|
| LLM inference | The provider you configured | Doesn't happen without a key |
| Model metadata | The public `models.dev` catalog | Falls back to the bundled snapshot |
| Marketplace | GitHub repositories you added | Doesn't happen without a source |
| Portable runtime download | Official Node / Python distributions (regional mirrors preferred) | Skipped if a system runtime is available |
| Automatic updates | `ASTRAVIA_UPDATE_URL` or GitHub Releases, as you configure | Not checked if unconfigured |
| MCP / plugins / IM / webhooks | Determined by the extensions you install and the credentials you enter | Doesn't happen if not installed |

No telemetry, no crash reporting, no usage analytics.

---

## Contributing

```bash
bun run check              # Biome + typecheck + architecture guards (required before a PR)
bun run check:quick        # fast feedback on changed files (no typecheck)
bun run test:unit          # core library unit tests
bun run test:pkg ai        # single-package tests; test:pkg --list shows what's testable
bun run test:changed       # only packages affected by your changes
```

Conventions worth knowing:

- **Bun** (`bun` / `bunx`) is the package manager, everywhere.
- No `any` in TypeScript unless genuinely necessary, and no inline `import()` used to obtain
  types. On the Go side, run `make check` after changes.
- All user-facing copy goes through i18n. Never hardcode strings.
- Commit messages are written in Chinese; reference issues with `fixes #N` / `closes #N`.
- Do not run `bun run dev` / `bun run build` / `bun test` directly.

Full rules in [AGENTS.md](AGENTS.md); the layered quality gates are described in
[docs/dev/quality-gates.md](docs/dev/quality-gates.md).

### Versioning and Releases

All packages share one version (lockstep), sourced from `@astravia/coding-agent`. There are no
major releases:

```bash
bun run release:patch    # fixes and new features
bun run release:minor    # API breaking changes
```

Each package keeps its own `packages/*/CHANGELOG.md`. New entries go under `## [Unreleased]`;
released sections are never edited.

### Documentation

- [docs/plugin/README.md](docs/plugin/README.md) — plugin developer handbook (11 documents)
- [docs/adr/](docs/adr) — architecture decision records
- [docs/capabilities/README.md](docs/capabilities/README.md) — foundation/domain capabilities and the permission layer
- [docs/open-marketplace.md](docs/open-marketplace.md) — open marketplace manifest format
- [docs/desktop/README.md](docs/desktop/README.md) — desktop packaging and the auto-update path
- [CONTEXT.md](CONTEXT.md) — domain glossary (check existing naming before writing code)

---

## Credits

This project stands on a good deal of other people's work. The following go directly into the
code or the distributed artifacts:

| Project | Where it's used | License |
|---------|-----------------|---------|
| [pi](https://github.com/badlogic/pi-mono) · Mario Zechner | `ai` / `agent` / `coding-agent` / `ecosystem-adapter` were rewritten and iterated on top of it; the agent loop, provider abstraction and extension mechanism trace back here | MIT |
| [Codex CLI](https://github.com/openai/codex) · OpenAI | The execution sandbox design draws on theirs; on Windows we ship their sandbox host binary directly | Apache-2.0 |
| [bubblewrap](https://github.com/containers/bubblewrap) | The Linux sandbox backend, distributed with the installer | LGPL-2.0+ |
| [PP-OCRv5](https://github.com/PaddlePaddle/PaddleOCR) · PaddlePaddle | Detection and recognition models for offline PDF OCR | Apache-2.0 |
| [python-build-standalone](https://github.com/astral-sh/python-build-standalone) · Astral | Distribution source for the portable Python runtime | See upstream |
| [Node.js](https://nodejs.org) | Distribution source for the portable Node runtime | MIT |
| [Cowart](https://github.com/zhongerxin/Cowart) | `plugins/externals/cowart-astravia` is adapted from it. That plugin lives in `externals/` and is **not bundled with the app** — it exists as a source example only | See upstream |

We're likewise indebted to the [Model Context Protocol](https://modelcontextprotocol.io)
specification, the public model catalog at [models.dev](https://models.dev), and to Electron,
React, Vite, Tailwind CSS, shadcn/ui, Jotai, TanStack Router, Biome and Bun.

The complete third-party inventory and original copyright notices are in [NOTICE](NOTICE).

## License

[Apache-2.0](LICENSE).
