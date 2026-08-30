# @astravia/desktop-app

Electron desktop host for the Astravia runtime.

## What It Owns

- Electron main/preload/renderer wiring
- desktop-specific IPC bridges
- file explorer, scheduler, project, and chat renderer domains
- integration of runtime packages into a desktop shell

## What It Does Not Own

- provider protocol implementations
- core agent loop logic
- business backend rules

## Who Depends On It

- end users running the desktop application

## Internal Boundaries

- `src/main`: Electron main process and native capabilities
- `src/preload`: safe bridge surface for the renderer
- `src/renderer`: React application domains and UI


## Database Engine (dbx)

P7 随包分发 dbx-mcp 原生二进制（`0.4.61`，Apache-2.0，上游 [t8y2/dbx](https://github.com/t8y2/dbx)，**Astravia 自有构建**：fork [maomaochong-ai/dbx](https://github.com/maomaochong-ai/dbx) 的 CI 流水线 `.github/workflows/dbx-mcp-astravia.yml` 构建并发布 Release，tag `dbx-mcp-astravia-v0.4.61`）。二进制不入库：`resources/dbx-mcp/` 已 gitignore，由 `scripts/fetch-dbx-mcp.mjs` 按当前平台下载（sha256 校验 + 幂等）；升级走「拉 fork 上游 → 评审 → CI 构建 → 更新版本/sha256」。平台：**win32-x64 / darwin-arm64 / darwin-x64** 均走 fork Release 直链（自有构建，darwin 于 B2.4 切换，此前走官方 npm 平台包 `@dbx-app/mcp-darwin-<arch>@0.4.61` 过渡源；多平台矩阵见交付文件 [dbx-mcp-astravia.yml](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/deliverables/dbx-mcp/dbx-mcp-astravia.yml)）。历史上 v0.4.61 曾直接取官方 npm 包 `@dbx-app/mcp-win32-x64@0.4.61`（B2.3 起 Windows 切换为自有构建）。

- 预设：设置 → 内置 MCP →「数据库引擎（dbx）」（i18n zh/en）；command 用 `{{dbxMcpBin}}` 占位符，写入 `mcp.json` 时由 `src/main/mcp/dbx-mcp-path.ts` 展开为绝对路径（dev: `process.cwd()/resources`，packaged: `process.resourcesPath`）。
- 能力：13 个 MCP 工具（连接管理 / 表结构 / 查询 / schema 上下文 / 会话）。连接配置由引擎自管（`dbx_add_connection` 等），不依赖 dbx 桌面应用；`dbx_open_table` / `dbx_execute_and_show` 为遥控桌面应用的命令（需桌面运行），Astravia 不自用，等价界面能力由 B2.6 自建经典界面实现。
- 分发：`scripts/prepare-pack.js` 将 `resources/dbx-mcp/` 打包为 extraResources。


## Development

Run `bun dev` from this package after installing the monorepo dependencies. The development startup
builds changed workspace prerequisites, stages plugin and theme manifests, then starts the renderer,
theme server, and Electron process in parallel.

Main-process sourcemaps are disabled by default to keep startup builds fast. Set
`ASTRAVIA_MAIN_SOURCEMAP=true` when source-mapped Electron stack traces are needed.

## Electron E2E (WebdriverIO)

Uses WebdriverIO + `@wdio/electron-service` (see `wdio.conf.ts`, `e2e/`).

```bash
# 1) Build main / preload / renderer artifacts
bun run build

# 2) Unpackaged smoke (default: dist/main/index.js)
bun run test:e2e

# Or smoke against electron-builder unpacked binary
bun run pack:win:test   # or pack:linux:test / platform equivalent
bun run test:e2e:packaged
```

Runtime sets `ASTRAVIA_E2E=1`, `ASTRAVIA_CONFIG_DIR=.astravia-e2e`, and isolates Chromium profile under `.wdio-electron-user-data`.
Day-to-day agent UI verification still uses repo-root `verify:ui:*` (Playwright); this suite targets formal E2E / CI.

Current `e2e/smoke.e2e.ts` batch-1 covers boot only: main-process ready/version, main window `index.html`, config/userData isolation, and a `dialog` mock probe. It does not cover login, chat, or other product flows.

