<p align="center">
  <img src="docs/assets/banner.webp" alt="Open Vetta">
</p>

<h1 align="center">Open Vetta</h1>

<p align="center">
  An open-source desktop AI agent for real work — local-first, extensible, and under your control.
</p>

<p align="center">
  <a href="https://www.openvetta.com"><img src="https://img.shields.io/badge/website-openvetta.com-0b7285" alt="Website"></a>
  <a href="https://docs.openvetta.com"><img src="https://img.shields.io/badge/docs-docs.openvetta.com-f06449" alt="Documentation"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="macOS, Windows, and Linux">
  <a href="https://coderabbit.ai"><img src="https://img.shields.io/coderabbit/prs/github/openvetta/open-vetta?utm_source=oss&utm_medium=github&utm_campaign=openvetta%2Fopen-vetta&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews" alt="CodeRabbit Pull Request Reviews"></a>
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://www.openvetta.com/download">Download</a> ·
  <a href="https://docs.openvetta.com/getting-started/">Get started</a> ·
  <a href="https://github.com/openvetta/open-vetta/discussions">Discussions</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

Open Vetta brings models, project files, local tools, and reusable capabilities into one desktop workspace. Use it for coding, documents, data, research, creative work, and repeatable workflows without giving up control of the environment where the work happens.

It is more than a chat interface: Vetta can inspect a workspace, use tools with visible permission boundaries, produce real files, and keep the execution trail available for review.

<p align="center">
  <img src="docs/assets/screenshot.png" alt="Open Vetta desktop workspace">
</p>

## Why Open Vetta

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
| Use the desktop app | [Download for macOS, Windows, or Linux](https://www.openvetta.com/download), then follow [installation and first setup](https://docs.openvetta.com/getting-started/). |
| Complete a real task | Follow the [first-task walkthrough](https://docs.openvetta.com/getting-started/first-task/). |
| Understand the product | Read the [product guide](https://docs.openvetta.com/product/overview/) and [security and data boundaries](https://docs.openvetta.com/reference/security-and-data/). |
| Build an extension | Choose between [skills, MCP, plugins, themes, SDK, RPC, and CLI](https://docs.openvetta.com/developers/overview/). |
| Contribute code | Read [`QUICKSTART.md`](QUICKSTART.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). |

### Run from source

Requires **Bun 1.3+** and **Node.js 20+**.

```bash
git clone https://github.com/openvetta/open-vetta.git
cd open-vetta
git switch dev
bun install
cd apps/desktop
bun run dev
```

The development app uses `~/.vetta-dev` by default, keeping installed-app data in `~/.vetta` untouched. Root-level `bun run dev` watches core libraries; it does not launch Electron. See [`QUICKSTART.md`](QUICKSTART.md) for the complete setup and validation commands.

## What you can do

- **Work in projects and sessions.** Keep task history, files, context, artifacts, and execution details together.
- **Use local and external tools.** Run commands, inspect files, connect MCP services, and approve sensitive operations explicitly.
- **Handle professional artifacts.** Preview and work with source code, PDF, Office files, spreadsheets, images, audio, video, SVG, and generated UI.
- **Scale a proven task.** Run the same workflow across directories with batch tasks, or schedule it as an automation.
- **Reuse organizational knowledge.** Build local knowledge bases and install reusable skills or scenarios.
- **Keep working away from the desk.** Use supported IM bridges, webhooks, notifications, quick entry, and native desktop integrations.

The public documentation has the current task guides and screenshots: [browse all product capabilities](https://docs.openvetta.com/product/overview/).

## Extension model

Vetta exposes several extension levels so a simple workflow does not need to become a full plugin:

| Extension | Use it for | Guide |
|---|---|---|
| **Skill** | Teach the agent a repeatable method or domain workflow. | [Abilities](https://docs.openvetta.com/product/abilities/) |
| **MCP** | Connect external tools and data over a standard protocol. | [MCP connectors](https://docs.openvetta.com/product/mcp/) |
| **Plugin** | Extend the desktop UI, files, messages, tools, and host actions. | [Plugin development](https://docs.openvetta.com/plugins/overview/) |
| **Theme** | Replace the visual system and provide theme-specific pages. | [Theme development](https://docs.openvetta.com/themes/overview/) |
| **SDK / RPC / CLI** | Embed or drive the agent from another application or process. | [Developer paths](https://docs.openvetta.com/developers/overview/) |

Plugins declare capabilities in `plugin.json`; privileged operations are authorized by the host and checked again at runtime. Plugins run inside the desktop renderer and should be treated as curated code, not as an arbitrary-code sandbox. Read the [plugin trust and permission model](https://docs.openvetta.com/plugins/manifest-and-permissions/) before distributing one.

## Data and build modes

A source checkout produces the **lite** build by default. It has no dependency on a Vetta-operated backend: no account, subscription, remote administration, or hosted marketplace is required. Model requests go to the endpoint you configure, and credentials remain in local credential storage.

Official installers may enable the optional Vetta Serv integration for accounts, subscriptions, and a hosted marketplace. That integration is selected at build time; it is not silently enabled in a lite build.

Local-first does not mean zero network traffic. Model providers, MCP servers, plugins, webhooks, IM integrations, update sources, and optional telemetry can each create their own data boundary. Review:

- [Security and data boundaries](https://docs.openvetta.com/reference/security-and-data/)
- [Configuration paths](https://docs.openvetta.com/reference/configuration-paths/)
- [Build modes and environment variables](docs/desktop/build-modes.en.md)
- [Security policy](SECURITY.md)

## Repository map

This is a Bun/TypeScript monorepo with additional Kotlin and Go applications. Dependencies point from applications toward reusable packages; `packages/*` never depend on `apps/*`.

| Area | Responsibility |
|---|---|
| [`apps/desktop`](apps/desktop) | Electron desktop host and renderer |
| [`apps/cli-host`](apps/cli-host) | CLI host for the coding agent |
| [`apps/docs-site`](apps/docs-site) | Next.js documentation site published at `docs.openvetta.com` |
| [`apps/mobile`](apps/mobile) | Kotlin Multiplatform Android client |
| [`apps/im-gateway`](apps/im-gateway) | Go IM sidecar gateway |
| [`packages/ai`](packages/ai) · [`packages/agent`](packages/agent) | Provider abstraction and the agent loop |
| [`packages/coding-agent`](packages/coding-agent) · `packages/runtime-*` | Product composition, runtime contracts, tools, storage, MCP, and host adapters |
| [`packages/plugins`](packages/plugins) · [`packages/themes`](packages/themes) | Extension SDKs, presets, and themes |

Architecture details and public integration contracts live in the [developer documentation](https://docs.openvetta.com/developers/architecture/) and [`docs/adr/`](docs/adr/).

## Develop and contribute

Use Bun and the repository scripts; do not run bare `bun test` in this monorepo.

```bash
bun run check:quick              # changed-file lint and architecture guards
bun run check                    # full lint, types, and architecture guards
bun run test:pkg <package-name>  # focused package tests
bun run test:changed             # tests affected by the current diff
```

Pull requests target the **`dev`** branch. The contribution map, test expectations, and review bar are in [`CONTRIBUTING.md`](CONTRIBUTING.md). Architecture and Agent collaboration rules are in [`AGENTS.md`](AGENTS.md).

Questions and early ideas belong in [GitHub Discussions](https://github.com/openvetta/open-vetta/discussions). Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/openvetta/open-vetta/security/advisories/new).

## Documentation

- [User and product guides](https://docs.openvetta.com/product/overview/)
- [Plugin development](https://docs.openvetta.com/plugins/overview/)
- [Theme development](https://docs.openvetta.com/themes/overview/)
- [SDK, RPC, CLI, and architecture](https://docs.openvetta.com/developers/overview/)
- [Troubleshooting](https://docs.openvetta.com/troubleshooting/)
- [`QUICKSTART.md`](QUICKSTART.md) for repository setup
- [`CONTRIBUTING.md`](CONTRIBUTING.md) for contributions
- [`docs/adr/`](docs/adr/) for architecture decisions

The documentation site also publishes [`llms.txt`](https://docs.openvetta.com/llms.txt), [`llms-full.txt`](https://docs.openvetta.com/llms-full.txt), and a Markdown representation of each page for Agent consumption.

## Credits and license

Open Vetta builds on work from the wider open-source ecosystem, including pi, Codex CLI, MCP, Electron, React, Bun, models.dev, and the projects listed in [`NOTICE`](NOTICE). The complete third-party inventory and original notices live there.

Licensed under [Apache-2.0](LICENSE).
