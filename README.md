# Vetta Monorepo

> **Private / Internal** — 公司内部私有项目。未经授权，请勿外传源码、凭证或构建产物。

Vetta 是一套面向企业与个人的 AI Agent 产品栈：在本地/桌面运行的编码与自动化智能体、企业后台、管理控制台，以及打通 IM 平台的旁路网关。本仓库以 monorepo 组织所有应用、运行时包和业务服务，统一版本发布。

> 仓库由 `@mariozechner/pi-ai` / `pi-mono` 演化而来，上游保留了通用的 LLM API 与 Agent Loop 能力；Vetta 在其基础上增加了桌面宿主（Electron）、业务后台（Go/Gin）、IM 旁路（Go）、管理台（React）以及批量任务、定时自动化、技能广场、工作流流转等企业侧能力。

---

## 快速开始

```bash
bun install                # 安装所有工作区依赖（需要 Bun 1.3+、Node 20+）
bun run build              # 构建所有核心库（packages/ai 等）
bun run check              # Biome + 类型检查 + 架构守卫（开 PR 前必跑）
bun run test:unit          # 核心库单元测试（ai/agent/coding-agent/ecosystem-adapter）
bun run test:pkg ai        # 只跑单个包测试；test:pkg --list 查看可测包
bun run test:changed       # 相对 origin/dev 只测变更触及的包

# 应用
bun run build:desktop      # 构建 Electron 桌面应用
bun run build:cli          # 构建 CLI 应用
bun run build:admin        # 构建 React 管理台

# 后端服务（Go）
cd packages/api && make run            # 启动业务 API
cd packages/im-gateway && make build   # 构建 IM 旁路网关
```

质量门禁分层、husky 快路径与守卫说明见 [docs/dev/quality-gates.md](docs/dev/quality-gates.md)。

桌面应用入口：`packages/desktop-app`；API 服务入口：`packages/api/cmd/server/main.go`。

---

## 产品矩阵

### 终端应用

| 包 | 角色 | 技术栈 |
|----|------|--------|
| [packages/desktop-app](packages/desktop-app) | Vetta 桌面应用。对话、文件浏览、批量任务、定时自动化、技能广场、工作流流转、下载中心、IM 旁路宿主 | Electron + React + Vite + Jotai + TanStack Router + shadcn/ui + Tailwind v4 |
| [packages/coding-agent](packages/coding-agent) | Vetta 编码智能体核心产品。CLI、交互模式、SDK、Extensions/Skills/Themes 生态 | TypeScript |
| [packages/cli-app](packages/cli-app) | 基于 `coding-agent` 的纯 CLI 封装 | TypeScript |

### 业务服务

| 包 | 角色 | 技术栈 |
|----|------|--------|
| [packages/api](packages/api) | 企业后端：鉴权、Provider 管理、技能市场、工作流、SSE 推送 | Go 1.25 · Gin · GORM · PostgreSQL · Redis · Casbin · S3 |
| [packages/admin](packages/admin) | 后台管理控制台：用户/组织/团队、Provider 审批、技能审核 | React + Vite + shadcn/ui |
| [packages/im-gateway](packages/im-gateway) | IM 平台旁路（飞书先行，Telegram/钉钉规划中）。作为桌面应用的 sidecar，桥接 IM 消息至本地 `coding-agent --mode rpc` | Go · NDJSON IPC |

### 核心库

| 包 | 职责 | 不包含 |
|----|------|--------|
| [packages/ai](packages/ai) | 多 Provider LLM API、模型注册表、Provider Adapter | Agent Loop、UI、会话持久化 |
| [packages/agent](packages/agent) | 有状态 Agent Loop、工具调用、事件流 | 终端/桌面 UI、业务规则 |
| [packages/tui](packages/tui) | 终端渲染原语与编辑器组件 | Agent 策略、会话存储 |
| [packages/web-ui](packages/web-ui) | 浏览器端可复用聊天 UI、Artifact、附件预览 | 桌面生命周期、服务端业务 |

### 运行时包（被宿主应用复用）

| 包 | 职责 |
|----|------|
| [packages/runtime-core](packages/runtime-core) | `RuntimeHost` 与 Session Facade，面向桌面宿主的运行时事件契约 |
| [packages/runtime-tools](packages/runtime-tools) | 内置工具重导出，供宿主复用（bash/edit/write/todo/current-time/invoke-skill 等） |
| [packages/runtime-storage](packages/runtime-storage) | 鉴权、会话、设置的存储原语 |
| [packages/runtime-mcp](packages/runtime-mcp) | MCP Manager 与 MCP Runtime 绑定 |
| [packages/runtime-telemetry](packages/runtime-telemetry) | 运行时日志与遥测抽象 |

依赖方向：应用 → runtime-\* → coding-agent / agent / ai。核心库不感知宿主；宿主包不引入业务后端规则；业务后端不依赖前端包。

---

## desktop-app 关键能力

`packages/desktop-app` 是 Vetta 在最终用户侧的主产品，承载以下 Domain（见 `src/renderer/domains/`）：

- **chat** — 主对话界面，消息流、Artifact、工具调用、回到底部与自动跟随
- **project** — 侧边栏项目/会话管理，支持普通、批量（batch）、定时（schedule）、流转（flowing）四类项目
- **batch-tasks** — 批量任务项目：一个 Prompt + 多个目标目录，按并发度串/并行执行，支持暂停/重试/全部重新开始
- **scheduler** — 自动化（Cron 定时触发执行）
- **flowing / flowing-chat** — 多 Agent 工作流流转（基于 `@xyflow/react` 的 DAG 编排）
- **skills** — 技能广场：从后端拉取技能，写入本地 `~/.vetta/agent/` 并与 coding-agent 集成
- **file-explorer / file-preview** — 本地文件树、PDF/DOCX 预览
- **activity-panel** — 侧面板：工具调用、请求历史、批量任务进度、调试
- **settings** — 设置：模型、Provider、快捷键、IM 集成（飞书）、系统
- **downloads / auth / message** — 下载中心、登录、消息中心

主进程（`src/main/`）职责：

- 窗口/托盘/自动更新（`window-manager.ts` / `tray-manager.ts` / `updater.ts`）
- 共享 `RuntimeHost`（`runtime.ts`）供 session / scheduler / batch-tasks 使用
- IPC 注册（`ipc/`，`vetta:*` 通道）
- 批量任务执行器与队列（`batch-tasks/`）
- 定时任务调度（`scheduler/`）
- IM 旁路子进程宿主（`im-host/`，拉起 `im-gateway host`）

渲染进程与主进程通过 preload 暴露的 `window.vetta.*` 通信（类型见 `src/renderer/global.d.ts`）。状态使用 Jotai atoms 按领域分层（`src/renderer/shared/store/*-atoms.ts`）。

---

## api 后端

`packages/api` 是基于 Gin + GORM 的业务后端，模块名 `vetta-api`。

- 入口：`cmd/server/main.go`
- 启动序：`config.Load` → `logger.Init` → `database.Init` → `store.InitRedis` → `rbac.InitEnforcer`（Casbin）→ `database.Seed` → `s3.Client` → `sse.Manager` → `router.Setup`
- 部署模式：`enterprise`（完整鉴权/组织/团队）与 `personal`（精简表与路由）由 `config.C.DeployMode` 切换
- 主要 Handler（见 `internal/handler/`）：
  - `auth` / `user` / `org` / `team` — 鉴权、用户、组织、团队
  - `provider` — LLM Provider 管理与审批
  - `skill` — 技能市场（CRUD、审核、分发）
  - `chat` — 基础聊天与流式响应
  - `workflow_admin` / `workflow` — 工作流管理与执行
  - `flowing_admin` / `flowing` — 工作流流转
  - `sse` — Server-Sent Events 推送
  - `gateway` — 对外统一网关
- 常用命令（`Makefile`）：`make run` / `make dev`（air 热重载）/ `make build` / `make migrate` / `make check`（`go build ./... && go vet ./...`）

配置优先级：`config.yaml` > `VETTA_*` 环境变量 > 默认值。示例见 `packages/api/config.example.yaml`。

---

## im-gateway IM 旁路

`packages/im-gateway` 将 IM 平台事件桥接到本地 `coding-agent --mode rpc` 子进程，让用户用手机或 IM 客户端驱动本地智能体，同时所有代码、工具、凭证都留在本机。

- **部署模式**：以 sidecar 形式嵌入 Vetta 桌面应用；用户在「设置 → IM 集成」填飞书凭证后，桌面主进程 spawn `im-gateway host` 子进程，生命周期绑定桌面应用（退出即终止）。
- **子命令**：`host`（嵌入式，stdin NDJSON 配置、stdout NDJSON 事件）/ `start`（开发者独立模式）/ `init` / `status` / `logs`。
- **共享会话**：与 desktop-app 共用 `~/.vetta/agent/sessions/` 会话文件，通过 `<file>.lock` 单写入协议保证一致性。IM 发起的对话可在桌面应用中继续。
- **架构**（详见 `packages/im-gateway/README.md`）：transport（Feishu/Mock）→ command → router（(im_user, project) → session）→ bridge → hostclient（coding-agent rpc）。

---

## 编码 Agent 与扩展生态

`packages/coding-agent` 是 Vetta 的编码智能体核心产品，支持交互、print/JSON、RPC、SDK 四种运行模式。通过 Extensions（TypeScript）、Skills（市场化的指令集）、Prompt Templates、Themes 四类扩展机制，可在不 fork 源码的前提下定制工作流。

仓库内置扩展示例：

- `packages/coding-agent/examples/extensions/with-deps`
- `custom-provider-anthropic` / `custom-provider-gitlab-duo` / `custom-provider-qwen-cli`

### MCP 支持

```jsonc
// ~/.vetta/agent/mcp.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
    }
  }
}
```

在交互模式下使用 `/mcp` 查看状态，MCP 工具会自动暴露给 Agent。详见 [`packages/coding-agent/docs/MCP.md`](packages/coding-agent/docs/MCP.md)。

---

## 开发约定

- **包管理器**：统一使用 Bun（`bun` / `bunx`）。除非用户明确要求 npm，不要切换。
- **代码质量**：TypeScript 侧禁止 `any`（除非确有必要）、禁止内联动态 `import()`；Go 侧改完必须跑 `make check`。整仓改完必须 `bun run check`（Biome + `tsgo --noEmit`）。
- **测试**：`bun run check` 不含测试。测试请从对应包根目录运行 `bunx tsx ../../node_modules/vitest/dist/cli.js --run test/xxx.test.ts`。
- **禁止命令**：不要直接 `bun run dev` / `bun run build` / `bun test`。
- **提交规范**：中文 commit message；禁止 `Co-Authored-By` 等作者标签；关联工单请在 commit 中写 `fixes #N` / `closes #N`。
- **并行代理 Git 规则**：只 `git add <具体路径>`，禁止 `git add -A/.`、`git reset --hard`、`git checkout .`、`git stash`、`--no-verify`。详见 [`AGENTS.md`](AGENTS.md)。

### Changelog

每个包独立维护 `packages/*/CHANGELOG.md`。所有新条目写入 `## [Unreleased]`，按 `Breaking Changes / Added / Changed / Fixed / Removed` 分节；已发布版本段不再改动。

### 版本与发布（Lockstep）

所有包共用版本号，版本源以 `@vetta/coding-agent` 为准（不做 major 发版）：

```bash
bun run release:patch    # Bug 修复与新增功能
bun run release:minor    # API Breaking
```

发布脚本完成版本号同步、CHANGELOG 定版、commit、tag、可选私服发布，并为下一轮补充 `[Unreleased]` 节。默认**不推送**私服；设置 `RELEASE_PUBLISH=true` 方可发布到配置的私有 registry。产物与安装指引生成于 `releases/v<version>/`，供上传到 Gitee Releases。

桌面安装包由 `.github/workflows/desktop-release.yml` 在三个操作系统分别构建，再发布到官方 R2/CDN 或公开 GitHub Releases；详见 [`docs/deploy/desktop-releases.md`](docs/deploy/desktop-releases.md)。

---

## 目录速览

```
vetta-mono/
├── packages/
│   ├── ai · agent · tui · web-ui            # 核心库
│   ├── runtime-core · runtime-tools · runtime-mcp · runtime-storage · runtime-telemetry
│   ├── coding-agent · cli-app · desktop-app # 终端应用
│   ├── api · admin · im-gateway             # 业务服务
│   └── coding-agent/examples/extensions/*   # 扩展示例
├── docs/                                    # 架构文档
├── scripts/                                 # 构建与发布脚本
├── releases/                                # 发布产物
├── AGENTS.md                                # 开发与 AI 协作规范
└── CLAUDE.md                                # Claude Code 指令（遵循 AGENTS.md）
```

架构文档：

- [`docs/capabilities/README.md`](docs/capabilities/README.md) — 基础/领域能力、直接基于 Capability ID 的通用权限层与系统适配层
- [`docs/architecture-overview.md`](docs/architecture-overview.md) — 依赖方向、请求流、应用/运行时边界
- [`docs/package-conventions.md`](docs/package-conventions.md) — 包与目录所有权约定
