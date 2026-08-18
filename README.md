# OpenVetta

Vetta 是一套面向企业与个人的 AI Agent 产品栈。本仓库是 Vetta 的**客户端侧开源仓库**：桌面应用、编码智能体、CLI、移动端、IM 旁路网关和文档站，连同它们依赖的全部运行时包。

> 服务端（业务 API、管理控制台、官网）在独立的 `vetta-serv` 仓库，不在此处。**文档站 `apps/docs-site` 在本仓库，欢迎社区参与维护。**

> 仓库由 `@mariozechner/pi-ai` / `pi-mono` 演化而来，上游保留了通用的 LLM API 与 Agent Loop 能力；Vetta 在其基础上增加了桌面宿主（Electron）、IM 旁路（Go）以及批量任务、定时自动化、技能广场、工作流流转等企业侧能力。

---

## 目录结构

顶层按「是否被别的包依赖」划分：

- **`apps/`** — 可交付的应用，依赖图的叶子节点，不被任何包 import：`desktop`、`cli-host`、`docs-site`、`mobile`（Kotlin Multiplatform，Android）与 `im-gateway`（Go）。
- **`packages/`** — 可复用模块，只能被 `apps/` 或其它 `packages/` 依赖：`coding-agent`、`runtime-*`、`capability-*`、`ai`、`agent`、`plugins`、`theme-*` 等。

`packages/*` 不得反向依赖 `apps/*`；该规则由 `scripts/quality/check-package-boundaries.mjs` 机械校验。

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
bun run build:docs         # 构建文档站

# IM 旁路（Go）
cd apps/im-gateway && make build   # 构建 IM 旁路网关
```

**桌面端默认构建 lite（serv-less）形态**：不含账号登录、Vetta Go 渠道与订阅计费，能力广场走 GitHub 仓库来源，零配置即可跑。本地会话、编码 Agent、插件系统、主题、自带 API Key 的模型一应俱全。要构建接入 Vetta 服务端的完全体，设 `VETTA_CLOUD_ENABLED=true`。两种模式的完整差异与全部环境变量见 [构建模式与环境变量](docs/desktop/build-modes.md)（[English](docs/desktop/build-modes.en.md)）。

质量门禁分层、husky 快路径与守卫说明见 [docs/dev/quality-gates.md](docs/dev/quality-gates.md)。

桌面应用入口：`apps/desktop`；文档站入口：`apps/docs-site`。

---

## 产品矩阵

### 终端应用

| 包 | 角色 | 技术栈 |
|----|------|--------|
| [apps/desktop](apps/desktop) | Vetta 桌面应用。对话、文件浏览、批量任务、定时自动化、技能广场、工作流流转、下载中心、IM 旁路宿主 | Electron + React + Vite + Jotai + TanStack Router + shadcn/ui + Tailwind v4 |
| [packages/coding-agent](packages/coding-agent) | Vetta 编码智能体核心产品。CLI、交互模式、SDK、Extensions/Skills/Themes 生态 | TypeScript |
| [apps/cli-host](apps/cli-host) | 基于 `coding-agent` 的纯 CLI 封装 | TypeScript |

### 旁路服务与文档站

| 包 | 角色 | 技术栈 |
|----|------|--------|
| [apps/docs-site](apps/docs-site) | 官方文档站，内容在 `content/`，欢迎社区 PR | Next.js |
| [apps/im-gateway](apps/im-gateway) | IM 平台旁路（飞书先行，Telegram/钉钉规划中）。作为桌面应用的 sidecar，桥接 IM 消息至本地 `coding-agent --mode rpc` | Go · NDJSON IPC |

### 核心库

| 包 | 职责 | 不包含 |
|----|------|--------|
| [packages/ai](packages/ai) | 多 Provider LLM API、模型注册表、Provider Adapter | Agent Loop、UI、会话持久化 |
| [packages/agent](packages/agent) | 有状态 Agent Loop、工具调用、事件流 | 终端/桌面 UI、业务规则 |

### 运行时包（被宿主应用复用）

| 包 | 职责 |
|----|------|
| [packages/runtime-core](packages/runtime-core) | `RuntimeHost` 与 Session Facade，面向桌面宿主的运行时事件契约 |
| [packages/runtime-tools](packages/runtime-tools) | 内置工具重导出，供宿主复用（bash/edit/write/todo/current-time/invoke-skill 等） |
| [packages/runtime-storage](packages/runtime-storage) | 鉴权、会话、设置的存储原语 |
| [packages/runtime-mcp](packages/runtime-mcp) | MCP Manager 与 MCP Runtime 绑定 |
| [packages/runtime-telemetry](packages/runtime-telemetry) | 运行时日志与遥测抽象 |

依赖方向：应用 → runtime-\* → coding-agent / agent / ai。核心库不感知宿主；宿主包不引入业务后端规则。

---

## desktop 关键能力

`apps/desktop` 是 Vetta 在最终用户侧的主产品，承载以下 Domain（见 `src/renderer/domains/`）：

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

## im-gateway IM 旁路

`apps/im-gateway` 将 IM 平台事件桥接到本地 `coding-agent --mode rpc` 子进程，让用户用手机或 IM 客户端驱动本地智能体，同时所有代码、工具、凭证都留在本机。

- **部署模式**：以 sidecar 形式嵌入 Vetta 桌面应用；用户在「设置 → IM 集成」填飞书凭证后，桌面主进程 spawn `im-gateway host` 子进程，生命周期绑定桌面应用（退出即终止）。
- **子命令**：`host`（嵌入式，stdin NDJSON 配置、stdout NDJSON 事件）/ `start`（开发者独立模式）/ `init` / `status` / `logs`。
- **共享会话**：与 desktop 共用 `~/.vetta/agent/sessions/` 会话文件，通过 `<file>.lock` 单写入协议保证一致性。IM 发起的对话可在桌面应用中继续。
- **架构**（详见 `apps/im-gateway/README.md`）：transport（Feishu/Mock）→ command → router（(im_user, project) → session）→ bridge → hostclient（coding-agent rpc）。

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
- **测试**：`bun run check` 不含测试。完整测试使用 `bun run test:unit`；单个包或测试文件从对应包根目录运行 `bun run test -- test/xxx.test.ts`。Vitest 由仓库统一使用 Node.js 20+ 启动，Bun 仅负责脚本与依赖管理。
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

发布脚本完成版本号同步、CHANGELOG 定版、commit、tag、可选私服发布，并为下一轮补充 `[Unreleased]` 节。默认**不推送**私服；设置 `RELEASE_PUBLISH=true` 方可发布到配置的私有 registry。产物与安装指引生成于 `releases/v<version>/`。

桌面安装包由 `.github/workflows/desktop-release.yml` 在三个操作系统分别构建，再发布到官方 CDN 或 GitHub Releases；详见 [`docs/deploy/desktop-releases.md`](docs/deploy/desktop-releases.md)，macOS 签名与公证见 [`docs/deploy/apple-code-signing.md`](docs/deploy/apple-code-signing.md)。

服务端（业务 API、管理控制台）的自托管部署不在本仓库，见 `vetta-serv` 仓库的 `deploy/` 与 `docs/deploy/deploy-runbook.md`。

---

## 目录速览

```
openvetta/
├── apps/
│   └── desktop · cli-host · im-gateway · mobile · docs-site
├── packages/
│   ├── ai · agent · coding-agent            # 核心库
│   ├── runtime-core · runtime-tools · runtime-mcp · runtime-storage · runtime-telemetry
│   ├── capability-* · theme-* · ui · markdown · toolkit
│   ├── plugins/                             # 插件 SDK 与系统插件 preset
│   └── coding-agent/examples/extensions/*   # 扩展示例
├── docs/                                    # 架构文档
├── scripts/                                 # 构建与发布脚本
├── releases/                                # 发布产物
├── AGENTS.md                                # 开发与 AI 协作规范
└── CLAUDE.md                                # Claude Code 指令（遵循 AGENTS.md）
```

架构文档：

- [`docs/adr/README.md`](docs/adr/README.md) — 架构决策记录索引，含编号规则与空洞说明
- [`docs/capabilities/README.md`](docs/capabilities/README.md) — 基础/领域能力、直接基于 Capability ID 的通用权限层与系统适配层
- [`docs/desktop/build-modes.md`](docs/desktop/build-modes.md) — 桌面端两种构建形态与全部环境变量
- [`docs/monorepo-new-package.md`](docs/monorepo-new-package.md) — 新增 workspace 包的完整步骤
