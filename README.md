<p align="center">
  <img src="docs/assets/banner.webp" alt="Astravia">
</p>

<h1 align="center">Astravia</h1>

<p align="center">
  An open-source desktop AI agent for real work — local-first, extensible, and under your control.
</p>

<p align="center">
  <a href="https://www.astravia.dev"><img src="https://img.shields.io/badge/website-astravia.dev-0b7285" alt="Website"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="macOS, Windows, and Linux">
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://www.astravia.dev/download">Download</a>
</p>

---

Astravia brings models, project files, local tools, and reusable capabilities into one desktop workspace. Use it for coding, documents, data, research, creative work, and repeatable workflows without giving up control of the environment where the work happens.

It is more than a chat interface: Astravia can inspect a workspace, use tools with visible permission boundaries, produce real files, and keep the execution trail available for review.

<p align="center">
  <img src="docs/assets/screenshot-main.png" alt="Astravia desktop workspace">
</p>

## Why Astravia

| | What it means |
|---|---|
| **Local-first workspace** | Projects, sessions, files, and execution live in the environment you choose. |
| **Bring your own models** | Connect supported providers, OpenAI-compatible endpoints, or local inference through BYOK. |
| **Real tools and artifacts** | Work with code, documents, spreadsheets, media, commands, and generated files in one task flow. |
| **Reviewable execution** | Tool calls, plans, permissions, progress, results, and recovery paths remain visible. |
| **Reusable workflows** | Extend the agent with skills, MCP servers, plugins, themes, knowledge, batch tasks, and automation. |
| **Open client stack** | The desktop app, CLI, SDK, plugin system, themes, mobile client, and IM gateway are developed in this repository. |

## Start here

| I want to… | Start with |
|---|---|
| Use the desktop app | [Download for macOS, Windows, or Linux](https://www.astravia.dev/download), then follow the in-app setup. |
| Understand the product | Explore the core capabilities below. |
| Build an extension | Choose between [skills, MCP, plugins, themes, SDK, RPC, and CLI](#plugin-development). |
| Contribute code | Read [`QUICKSTART.md`](QUICKSTART.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). |

### Run from source

Requires **Bun 1.3+** and **Node.js 20+**.

```bash
git clone git@github.com:maomaochong-ai/open-astravia.git
cd open-astravia
git switch dev
bun install
cd apps/desktop
bun run dev
```

The development app uses `~/.astravia-dev` by default, keeping installed-app data in `~/.astravia` untouched. Root-level `bun run dev` watches core libraries; it does not launch Electron. See [`QUICKSTART.md`](QUICKSTART.md) for the complete setup and validation commands.

## What you can do

- **Work in projects and sessions.** Keep task history, files, context, artifacts, and execution details together.
- **Use local and external tools.** Run commands, inspect files, connect MCP services, and approve sensitive operations explicitly.
- **Handle professional artifacts.** Preview and work with source code, PDF, Office files, spreadsheets, images, audio, video, SVG, and generated UI.
- **Scale a proven task.** Run the same workflow across directories with batch tasks, or schedule it as an automation.
- **Reuse organizational knowledge.** Build local knowledge bases and install reusable skills or scenarios.
- **Keep working away from the desk.** Use supported IM bridges, webhooks, notifications, quick entry, and native desktop integrations.

## Core capabilities

### Conversation and workspace
Message stream, tool calls, and generated results all visible on one screen; files previewable in-app (PDF, Word, PPT, spreadsheets, images, audio/video, SVG); offline OCR for scanned PDFs. Built-in coding-agent reads and writes project files, runs commands, takes screenshots.

### Database workbench
40+ database connections (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Doris, OceanBase…); multi-tab SQL workbench with history and CSV/JSON export; AI queries data directly in conversation; write operations gated by tiered authorization, prod connections default to read-only.

### Batch tasks & scheduled dispatch
Run one prompt across many directories; built-in Cron scheduling with tray background execution, retryable history.

### Notifications & remote control
Batch/scheduled task completion and alerts pushed to Feishu/DingTalk bots (credentials encrypted locally); Feishu IM controls the local agent.

### Extension ecosystem
Install skills, MCP servers, plugins and themes from GitHub repositories; local documents processed into searchable knowledge bases without leaving your machine. Permission system: every capability must declare permissions, the host authorizes individually, validates again at runtime.

### UI design workspace
Designs on an infinite canvas are real runnable interfaces, sharing a color system; export renderings or read-only share packages.

### Desktop integration
Global hotkey for quick panel; macOS Appshot gesture screenshots + on-screen text to agent; Node/Python runtime config; tray presence; electron-updater auto-update; bilingual UI.

## Plugin development

Astravia's own design canvas, Git, charts, and file preview are plugins — the same extension points are open to third parties. Plugins are built with Vite + Module Federation into independent bundles, loaded by the host on demand, sandboxed, and permission-checked.

### Build a plugin from any directory

You do not need this repository to build a plugin. Nor does an agent:

```bash
npx @astravia-org/plugin-cli init --id my-plugin --name "My Plugin"
cd my-plugin && npm install
npx astravia-plugin-cli docs        # where the manual is, and which SDK version it documents
npm run install:astravia            # build, package, install into the running desktop app
npx astravia-plugin-cli watch       # hot reload: the host loads the plugin from this directory
```

`init` also writes an `AGENTS.md`, so **any** coding agent picks the project up without host-side setup. The plugin manual ships inside `@astravia-org/plugin-sdk`, so the contract an agent reads is the contract the project compiles against; `docs` locates it rather than anyone hard-coding a `node_modules` path.

Plugins declare capabilities in `plugin.json`; privileged operations are authorized by the host and checked again at runtime. Plugins run inside the desktop renderer and should be treated as curated code, not as an arbitrary-code sandbox.

### Build and install

```bash
# package.json
{
  "scripts": { "build": "vite build" },
  "dependencies": { "@astravia-org/plugin-sdk": "latest" },
  "devDependencies": { "@astravia-org/plugin-vite": "latest", "vite": "^7" }
}

# vite.config.ts
import { astraviaPluginFederation } from "@astravia-org/plugin-vite";
export default defineConfig({ plugins: [astraviaPluginFederation({ name: "my_plugin", entry: "./src/index.tsx" })] });
```

```bash
bun install
bun run build           # output: dist/mf-manifest.json + dist/remoteEntry.js + dist/style.css
zip -r my-plugin.zip .  # package the whole plugin directory (including plugin.json)
```

Install: in Astravia, open "Settings → Plugins → Install local plugin" and pick the zip. You can also publish to a GitHub Release and install with the repository URL in one click.

**Built-in plugins**: astravia-ui-design, content-creation, plugin-workbench, git, image-gen, chart-renderer, office-viewer, media-viewer, svg-viewer, astravia-actions.

## Data and build modes

A source checkout produces the **lite** build by default. It has no dependency on a hosted backend: no account, subscription, remote administration, or hosted marketplace is required. Model requests go to the endpoint you configure, and credentials remain in local credential storage.

Local-first does not mean zero network traffic. Model providers, MCP servers, plugins, webhooks, IM integrations, update sources, and optional telemetry can each create their own data boundary. Review the "network behavior" section of [`README.zh-CN.md`](README.zh-CN.md) for the full list.

## Repository map

This is a Bun/TypeScript monorepo with additional Swift, Kotlin and Go applications. Dependencies point from applications toward reusable packages; `packages/*` never depend on `apps/*`.

| Area | Responsibility |
|---|---|
| [`apps/desktop`](apps/desktop) | Electron desktop host and renderer |
| [`apps/cli-host`](apps/cli-host) | CLI host for the coding agent |
| [`apps/docs-site`](apps/docs-site) | Next.js documentation site |
| [`apps/mobile/client-apple`](apps/mobile/client-apple) | Native iOS client in Swift/SwiftUI |
| [`apps/mobile/client-android`](apps/mobile/client-android) | Kotlin Multiplatform Android client |
| [`apps/im-gateway`](apps/im-gateway) | Go IM sidecar gateway |
| [`packages/ai`](packages/ai) · [`packages/agent`](packages/agent) | Provider abstraction and the agent loop |
| [`packages/coding-agent`](packages/coding-agent) · `packages/runtime-*` | Product composition, runtime contracts, tools, storage, MCP, and host adapters |
| [`packages/plugins`](packages/plugins) · [`packages/themes`](packages/themes) | Extension SDKs, presets, and themes |

Architecture details and public integration contracts live in [`docs/adr/`](docs/adr/).

## Develop and contribute

Use Bun and the repository scripts; do not run bare `bun test` in this monorepo.

```bash
bun run check:quick              # changed-file lint and architecture guards
bun run check                    # full lint, types, and architecture guards
bun run test:pkg <package-name>  # focused package tests
bun run test:changed             # tests affected by the current diff
```

Pull requests target the **`dev`** branch. The contribution map, test expectations, and review bar are in [`CONTRIBUTING.md`](CONTRIBUTING.md). Architecture and Agent collaboration rules are in [`AGENTS.md`](AGENTS.md).

Questions and early ideas belong in GitHub Discussions. Report vulnerabilities privately through GitHub Security Advisories.

## Community

<p align="center">
  <table width="100%" style="border-collapse:separate;border-spacing:16px 0;">
    <tr>
      <td align="center" style="border:1px solid #d0d7de;border-radius:12px;padding:20px 16px;background:#f6f8fa;vertical-align:top;">
        <div style="display:inline-block;padding:3px 10px;border-radius:20px;background:#12b7f5;color:#fff;font-size:12px;font-weight:600;margin-bottom:12px;">QQ</div><br />
        <img src="docs/assets/community/qq-group.png" width="200" alt="QQ group" style="border-radius:6px;" /><br />
        <p style="margin:12px 0 0 0;font-weight:600;font-size:15px;">Official QQ group</p>
        <p style="margin:4px 0 0 0;color:#656d76;font-size:13px;">Daily discussion · issue feedback</p>
      </td>
      <td align="center" style="border:1px solid #d0d7de;border-radius:12px;padding:20px 16px;background:#f6f8fa;vertical-align:top;">
        <div style="display:inline-block;padding:3px 10px;border-radius:20px;background:#07c160;color:#fff;font-size:12px;font-weight:600;margin-bottom:12px;">WeChat</div><br />
        <img src="docs/assets/community/wechat-group.jpg" width="200" alt="WeChat group" style="border-radius:6px;" /><br />
        <p style="margin:12px 0 0 0;font-weight:600;font-size:15px;">Official WeChat group</p>
        <p style="margin:4px 0 0 0;color:#656d76;font-size:13px;">Release updates · beta recruitment</p>
      </td>
    </tr>
  </table>
</p>

## Credits and license

Astravia builds on work from the wider open-source ecosystem, including pi, Codex CLI, MCP, Electron, React, Bun, models.dev, and the projects listed in [`NOTICE`](NOTICE). The complete third-party inventory and original notices live there.

Licensed under [Apache-2.0](LICENSE).
