# Quickstart

<p align="center"><b>English</b> · <a href="QUICKSTART.zh-CN.md">简体中文</a></p>

Two ways in: install a build, or run the desktop app from this repository.

## Use the app

Installers for macOS, Windows, and Linux:

**→ [www.openvetta.com/download](https://www.openvetta.com/download)**

Official installers are published on the website CDN. This repository is the source. After install, the setup wizard walks through model configuration (BYOK) and permissions. Product guides: [docs.openvetta.com](https://docs.openvetta.com).

A source checkout produces the **lite** build: no Vetta login, no subscription, keys stay on your machine. Official installers may be the **full** build. The two shapes are documented in [Build Modes](docs/desktop/build-modes.en.md).

## Develop from source

Requires **Bun 1.3+** and **Node 20+**. macOS, Windows, and Linux are supported.

```bash
git clone https://github.com/openvetta/open-vetta.git
cd open-vetta
git checkout dev
bun install
```

### Desktop app

```bash
cd apps/desktop
bun run dev
```

That starts the Vite renderer, the theme dev server, and Electron together. The process uses `~/.vetta-dev`, so your installed-app data in `~/.vetta` is left alone.

| Command | Data root | When to use it |
|---|---|---|
| `bun run dev` | `~/.vetta-dev` | Default sandbox |
| `bun run dev:home` | `~/.vetta` | You want the dev build to read and write real user data |

`bun run dev` **at the repository root** only watches core libraries. It does not launch the app.

### Documentation site

```bash
bun run --cwd apps/docs-site dev
```

Opens on `http://127.0.0.1:4321`. Public docs live in `apps/docs-site/content/docs/`.

### Checks you will actually run

```bash
bun run check:quick        # Biome + architecture guards on changed files
bun run check              # lint + types + guards, before a PR
bun run test:pkg ai        # one package; `bun run test:pkg --list` shows names
```

Do not run bare `bun test`. On Windows it is the wrong runner; use `bun scripts/quality/run-vitest.mjs --run <file>` or `bun run test:pkg`.

Packaging, environment variables, and the lite/full flag: [Build Modes](docs/desktop/build-modes.en.md). Contribution map and PR bar: [CONTRIBUTING.md](CONTRIBUTING.md).
