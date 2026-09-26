<div align="center">
  <img src="docs/assets/banner.png" width="128" alt="Astravia" />
  <h3>Astravia · 星轨</h3>
  <p><strong>本地优先的开源 AI 桌面助手</strong></p>
  <p>编码 · 文档 · 数据 · 自动化 · 设计 — 一个应用全包</p>
  <p>无云端 · 无账号 · 无遥测 — 数据与密钥始终留在你的本机</p>
  <p><b>简体中文</b> · <a href="README.en-US.md">English</a></p>
</div>

---

<p align="center">
  <img src="docs/assets/screenshot-main.png" alt="Astravia 深色主题" width="860" />
</p>

## 快速上手

1. **下载安装包**：从 [GitHub Releases](https://github.com/maomaochong-ai/astravia/releases) 获取 macOS（Apple Silicon / Intel）或 Windows x64 安装包
2. **配置模型**：设置中选择服务商，填入你自己的 Key（支持 Claude、OpenAI、DeepSeek、Kimi、Gemini、Grok、Qwen 等）
3. **开始使用**：写代码、整理文档、处理文件、查数据库、批量与定时任务

## 核心能力

### 对话与工作区
消息流、工具调用、生成结果同屏可见；文件在应用内直接预览（PDF、Word、PPT、表格、图片、音视频、SVG）；扫描版 PDF 离线 OCR。内置 coding-agent 可读写工程文件、运行命令、截图。

### 数据库工作台
内置 40+ 数据库连接（PostgreSQL、MySQL、SQLite、SQL Server、Oracle、Doris、OceanBase…），SQL 工作台多标签查询、历史记录、CSV/JSON 导出；AI 可在对话中直接查数；写操作分级授权，prod 连接默认只读。dbx（Apache-2.0）随应用分发，无需额外安装。

### 批量任务 & 定时调度
一个 Prompt 对多目录批量执行；内置 Cron 调度，托盘后台运行，历史可查、可重试。

### 通知与远程控制
批量 / 定时任务完成或异常推送飞书、钉钉机器人（凭据本地加密）；飞书 IM 遥控本机 Agent（Telegram、钉钉规划中）。

### 扩展生态
从 GitHub 仓库安装 Skill、MCP Server、插件与主题；本地文档加工成可检索知识库，全程不出本机。插件权限系统：每项能力必须声明权限，宿主单独授权、运行时校验。

### UI 设计工作区
无限画布上的设计稿即真实可运行界面，共享色彩系统，可导出渲染图或只读分享包。

### 桌面集成
全局快捷键唤起快捷面板；macOS Appshot 手势截图 + 屏上文字交给 Agent；Node / Python 运行时配置；托盘常驻；electron-updater 自动更新；中英双语界面。

## 插件系统

设计画布、内容创作、Git、图表、文件预览这些工作区形态本身就是插件。同一套扩展点对第三方开放，插件既能扩展界面（活动面板、文件预览、消息卡片、快捷键），也能扩展 Agent（系统提示词、技能、工具、MCP Server、会话引导）。

```tsx
import { definePlugin } from "@astravia-org/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    ctx.ui.registerActivityTab({ id: "my-tab", label: "我的面板", component: MyPanel });
  },
});
```

**内置插件**：astravia-ui-design、content-creation、plugin-workbench、git、image-gen、chart-renderer、office-viewer、media-viewer、svg-viewer、astravia-actions。

## 模型配置

- 内置服务商预设：Claude、OpenAI、DeepSeek、Z.ai、Kimi、Gemini、Grok、Qwen — 预设只含 baseUrl 与 API 类型，**不含任何 Key**
- 填入 Key 后立即同步该账号可用模型，之后每 12 小时后台同步
- 请求直发服务商，应用不代理、不转发、不计费
- 支持 OpenAI 兼容端点（Ollama / vLLM / LM Studio 本地推理）
- 模型元数据由 [models.dev](https://models.dev) 补齐，随包带快照兜底

## 网络行为

| 场景 | 触发条件 |
| --- | --- |
| LLM 推理 | 你配置的服务商；不配 Key 即不发生 |
| 模型元数据 | `models.dev` 公共目录；失败回退随包快照 |
| 能力市场 | 你添加的 GitHub 仓库；不加来源即不发生 |
| 自动更新 | 更新源由应用配置决定（基于 electron-updater） |
| MCP / 插件 / IM | 由你安装的扩展与填写的凭据决定 |

**没有遥测，没有崩溃上报，没有使用统计。**

## 从源码构建

需要 **Bun 1.3+** 与 **Node 20+**：

```bash
bun install
bun run build
bun run build:desktop     # 桌面应用
bun run build:cli         # 可选：CLI 封装
```

IM 旁路网关（Go，可选）：`cd packages/im-gateway && make build`。

## 参与开发

```bash
bun run check              # Biome + 类型检查 + 架构守卫（开 PR 前必跑）
bun run check:quick        # 改动文件快速反馈
bun run test:unit          # 核心库单元测试
bun run test:changed       # 只跑受改动影响的包
```

约定：包管理统一用 **Bun**；TypeScript 禁止无必要 `any`；用户可见文案必须走 i18n；提交信息用中文（`fixes #N` / `closes #N`）。完整规范见 [AGENTS.md](AGENTS.md)。

## 架构

Monorepo，**依赖单向向下**：宿主应用 → runtime 适配层 → AI/Agent 内核。核心库不感知宿主，同一套内核既能跑在 Electron 桌面端，也能跑在终端 CLI。

```
astravia/
├── packages/
│   ├── ai                     — 多 Provider LLM 适配（Claude / OpenAI / DeepSeek / Kimi / ...）
│   ├── agent                  — Agent 循环、会话管理、工具调度
│   ├── coding-agent           — 编码智能体：读写工程文件、执行命令、截图
│   ├── ecosystem-adapter      — 能力市场、插件与 Skill 的运行时适配
│   ├── runtime-core           — 宿主共享适配层：配置目录、凭据存储、事件总线
│   ├── runtime-tools          — 宿主共享适配层：文件系统、命令执行、网络请求
│   ├── runtime-storage        — 宿主共享适配层：会话持久化、工作区索引
│   ├── runtime-mcp            — MCP Server 生命周期管理
│   ├── runtime-telemetry      — 遥测（仅落盘，不发送）
│   ├── desktop-app            — Electron 桌面宿主（macOS / Windows 原生签名）
│   ├── cli-app                — 终端 CLI 宿主
│   ├── im-gateway             — Go 实现的 IM 旁路网关（飞书，随应用启停）
│   ├── ui                     — React 组件原语
│   ├── theme-ui               — 主题化 UI 组件
│   ├── theme-sdk              — 主题开发 SDK（颜色令牌、组件覆盖点）
│   ├── plugins                — 预装插件集合（UI 设计、内容创作、Git、图表、预览…）
│   ├── skill-presets          — 预装 Skill 预设
│   ├── themes                 — 预装主题
│   ├── capability-sdk         — 能力与权限定义 SDK
│   ├── capability-runtime     — 能力运行时（权限校验、能力编排）
│   ├── action-rpc             — Agent ↔ Desktop 间的 RPC 协议
│   └── toolkit                — 开发辅助工具集
├── docs/                      — 架构文档与 ADR
└── scripts/                   — 构建、发布、质量守卫
```

**依赖关系**：
- `desktop-app` / `cli-app` → `runtime-*` → `coding-agent` / `agent` / `ai`
- `ai` ← `agent` ← `coding-agent`（Agent 持有 LLM 调用能力）
- `runtime-*` 不依赖 AI 层，`capability-*` 跨层提供权限定义
- `plugins` / `skill-presets` / `themes` 是纯粹的资源包，无业务依赖

## 加入社群

<div align="center">
  <table>
    <tr>
      <td align="center"><img src="docs/assets/community/qq-group.png" width="220" alt="QQ 群" /><p>QQ 群</p></td>
      <td align="center"><img src="docs/assets/community/wechat-group.png" width="220" alt="微信群" /><p>微信群</p></td>
    </tr>
  </table>
  <p>扫码加入社群，交流使用经验、反馈问题、获取最新动态。</p>
</div>

## 致谢

| 项目 | 用途 | 许可 |
| --- | --- | --- |
| pi · Mario Zechner | ai / agent / coding-agent 在其基础上重写与迭代 | MIT |
| Codex CLI · OpenAI | 执行沙箱方案借鉴其设计 | Apache-2.0 |
| bubblewrap | Linux 沙箱后端 | LGPL-2.0+ |
| PP-OCRv5 · PaddlePaddle | 离线 PDF OCR | Apache-2.0 |
| dbx | 数据库引擎 | Apache-2.0 |
| python-build-standalone / Node.js | 便携运行时 | 见原仓库 |

感谢 [Model Context Protocol](https://modelcontextprotocol.io) 规范与 [models.dev](https://models.dev) 公共模型目录。第三方完整清单见 [NOTICE](NOTICE)。

## 许可

[Apache-2.0](LICENSE)
