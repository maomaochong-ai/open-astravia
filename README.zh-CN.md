<p align="center">
  <img src="docs/assets/banner.webp" alt="Open Vetta">
</p>

<h1 align="center">Open Vetta</h1>

<p align="center">
  面向真实工作的开源桌面 AI Agent——本地优先、可扩展，由你掌控。
</p>

<p align="center">
  <a href="https://www.openvetta.com"><img src="https://img.shields.io/badge/官网-openvetta.com-0b7285" alt="官网"></a>
  <a href="https://docs.openvetta.com"><img src="https://img.shields.io/badge/文档-docs.openvetta.com-f06449" alt="文档"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/许可-Apache--2.0-blue" alt="Apache-2.0 许可"></a>
  <img src="https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="macOS、Windows 与 Linux">
  <a href="https://coderabbit.ai"><img src="https://img.shields.io/coderabbit/prs/github/openvetta/open-vetta?utm_source=oss&utm_medium=github&utm_campaign=openvetta%2Fopen-vetta&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews" alt="CodeRabbit Pull Request Reviews"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <b>简体中文</b> ·
  <a href="https://www.openvetta.com/download">下载</a> ·
  <a href="https://docs.openvetta.com/getting-started/">快速开始</a> ·
  <a href="https://github.com/openvetta/open-vetta/discussions">社区讨论</a> ·
  <a href="CONTRIBUTING.zh-CN.md">参与贡献</a>
</p>

---

Open Vetta 把模型、项目文件、本机工具和可复用能力放进同一个桌面工作区。它适用于编码、文档、数据、研究、创意生产和可重复工作流，同时让工作继续发生在你选择的环境中。

它不只是聊天界面：Vetta 能理解工作区、在可见的权限边界内调用工具、交付真实文件，并保留可供检查的执行过程。

<p align="center">
  <img src="docs/assets/screenshot.png" alt="Open Vetta 桌面工作区">
</p>

## 为什么选择 Open Vetta

| | 对你意味着什么 |
|---|---|
| **本地优先的工作区** | 项目、会话、文件与执行过程留在你选择的环境中。 |
| **自带模型** | 通过 BYOK 连接受支持的 Provider、OpenAI 兼容端点或本地推理服务。 |
| **真实工具与产物** | 在同一条任务流中处理代码、文档、表格、媒体、命令和生成文件。 |
| **过程可检查** | 工具调用、计划、权限、进度、结果和恢复路径都有记录。 |
| **方法可复用** | 使用技能、MCP、插件、主题、知识库、批量任务和自动化持续积累能力。 |
| **开放的客户端栈** | 桌面端、CLI、SDK、插件系统、主题、移动端与 IM 网关都在本仓库开发。 |

## 从这里开始

| 我想要…… | 从这里开始 |
|---|---|
| 使用桌面应用 | [下载 macOS、Windows 或 Linux 客户端](https://www.openvetta.com/download)，然后完成[安装与首次设置](https://docs.openvetta.com/getting-started/)。 |
| 跑通一个真实任务 | 跟随[第一个任务教程](https://docs.openvetta.com/getting-started/first-task/)。 |
| 理解产品能力 | 阅读[使用指南](https://docs.openvetta.com/product/overview/)和[安全与数据边界](https://docs.openvetta.com/reference/security-and-data/)。 |
| 开发扩展 | 在[技能、MCP、插件、主题、SDK、RPC 与 CLI](https://docs.openvetta.com/developers/overview/)之间选择正确入口。 |
| 参与代码开发 | 阅读 [`QUICKSTART.zh-CN.md`](QUICKSTART.zh-CN.md) 与 [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)。 |

### 从源码运行

需要 **Bun 1.3+** 与 **Node.js 20+**。

```bash
git clone https://github.com/openvetta/open-vetta.git
cd open-vetta
git switch dev
bun install
cd apps/desktop
bun run dev
```

开发应用默认使用 `~/.vetta-dev`，不会改动正式安装版位于 `~/.vetta` 的数据。仓库根目录的 `bun run dev` 只监听核心库，不会启动 Electron。完整环境准备与检查命令见 [`QUICKSTART.zh-CN.md`](QUICKSTART.zh-CN.md)。

## 可以用它做什么

- **在项目和会话中工作。** 把任务历史、文件、上下文、产物和执行详情放在一起。
- **使用本机与外部工具。** 运行命令、检查文件、连接 MCP 服务，并显式批准敏感操作。
- **处理专业产物。** 预览和处理源码、PDF、Office 文件、表格、图片、音视频、SVG 与生成式 UI。
- **放大已经跑通的任务。** 用批量任务处理多个目录，或把稳定流程交给自动化定时执行。
- **复用组织知识。** 建立本地知识库，安装可复用的技能和场景。
- **离开电脑也能继续。** 使用受支持的 IM 桥接、Webhook、通知、快捷输入和桌面原生集成。

公开文档持续维护当前任务指南与截图：[浏览全部产品能力](https://docs.openvetta.com/product/overview/)。

## 扩展模型

Vetta 提供不同重量的扩展入口，简单流程不必被做成完整插件：

| 扩展 | 适合做什么 | 指南 |
|---|---|---|
| **技能** | 让 Agent 遵循可重复的领域方法或工作流。 | [能力管理](https://docs.openvetta.com/product/abilities/) |
| **MCP** | 通过标准协议连接外部工具与数据。 | [MCP 连接器](https://docs.openvetta.com/product/mcp/) |
| **插件** | 扩展桌面 UI、文件、消息、工具与宿主动作。 | [插件开发](https://docs.openvetta.com/plugins/overview/) |
| **主题** | 替换视觉系统并提供主题专属页面。 | [主题开发](https://docs.openvetta.com/themes/overview/) |
| **SDK / RPC / CLI** | 在其他应用或进程中嵌入、驱动 Agent。 | [开发与集成路径](https://docs.openvetta.com/developers/overview/) |

插件通过 `plugin.json` 声明能力；高权限操作由宿主授权，并在运行时再次检查。插件运行在桌面渲染进程中，应被视为经过策展的代码，而不是任意代码沙箱。分发插件前请阅读[插件信任与权限模型](https://docs.openvetta.com/plugins/manifest-and-permissions/)。

## 数据与构建模式

源码检出默认生成 **lite** 构建，不依赖 Vetta 运营的后端：不要求账号、订阅、远程管理或托管市场。模型请求直达你配置的端点，凭据保存在本地凭据存储中。

官方安装包可能启用可选的 Vetta Serv 集成，用于账号、订阅和托管市场。该能力在构建期选择，不会在 lite 构建中被静默打开。

本地优先不等于完全没有网络流量。模型 Provider、MCP、插件、Webhook、IM、更新源和可选遥测分别形成自己的数据边界。使用前请阅读：

- [安全与数据边界](https://docs.openvetta.com/reference/security-and-data/)
- [配置与数据路径](https://docs.openvetta.com/reference/configuration-paths/)
- [构建模式与环境变量](docs/desktop/build-modes.md)
- [安全策略](SECURITY.md)

## 仓库结构

本仓库是 Bun/TypeScript Monorepo，同时包含 Kotlin 与 Go 应用。依赖从应用指向可复用包，`packages/*` 不反向依赖 `apps/*`。

| 范围 | 职责 |
|---|---|
| [`apps/desktop`](apps/desktop) | Electron 桌面宿主与渲染层 |
| [`apps/cli-host`](apps/cli-host) | Coding Agent 的 CLI 宿主 |
| [`apps/docs-site`](apps/docs-site) | 发布到 `docs.openvetta.com` 的 Next.js 文档站 |
| [`apps/mobile`](apps/mobile) | Kotlin Multiplatform Android 客户端 |
| [`apps/im-gateway`](apps/im-gateway) | Go 编写的 IM 旁路网关 |
| [`packages/ai`](packages/ai) · [`packages/agent`](packages/agent) | Provider 抽象与 Agent Loop |
| [`packages/coding-agent`](packages/coding-agent) · `packages/runtime-*` | 产品组合、运行时合同、工具、存储、MCP 与宿主适配 |
| [`packages/plugins`](packages/plugins) · [`packages/themes`](packages/themes) | 扩展 SDK、内置扩展与主题 |

架构细节与公共集成合同见[开发者架构文档](https://docs.openvetta.com/developers/architecture/)和 [`docs/adr/`](docs/adr/)。

## 开发与贡献

统一使用 Bun 和仓库脚本；不要在这个 Monorepo 中运行裸 `bun test`。

```bash
bun run check:quick              # 检查改动文件与架构边界
bun run check                    # 完整 lint、类型和架构守卫
bun run test:pkg <package-name>  # 定向包测试
bun run test:changed             # 运行当前 diff 影响的测试
```

Pull Request 发往 **`dev`** 分支。贡献地图、测试要求与评审门槛见 [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)，架构和 Agent 协作规则见 [`AGENTS.md`](AGENTS.md)。

问题和早期想法请发到 [GitHub Discussions](https://github.com/openvetta/open-vetta/discussions)。安全漏洞请通过 [GitHub Security Advisories](https://github.com/openvetta/open-vetta/security/advisories/new) 私下报告。

## 文档导航

- [用户与产品指南](https://docs.openvetta.com/product/overview/)
- [插件开发](https://docs.openvetta.com/plugins/overview/)
- [主题开发](https://docs.openvetta.com/themes/overview/)
- [SDK、RPC、CLI 与架构](https://docs.openvetta.com/developers/overview/)
- [故障排查](https://docs.openvetta.com/troubleshooting/)
- [`QUICKSTART.zh-CN.md`](QUICKSTART.zh-CN.md)：仓库环境准备
- [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)：参与贡献
- [`docs/adr/`](docs/adr/)：架构决策记录

文档站同时提供 [`llms.txt`](https://docs.openvetta.com/llms.txt)、[`llms-full.txt`](https://docs.openvetta.com/llms-full.txt)，以及每个页面的 Markdown 版本，方便 Agent 获取内容。

## 致谢与许可

Open Vetta 建立在广泛的开源生态之上，包括 pi、Codex CLI、MCP、Electron、React、Bun、models.dev，以及 [`NOTICE`](NOTICE) 中列出的项目。完整第三方清单与原始版权声明以该文件为准。

本项目采用 [Apache-2.0](LICENSE) 许可。
