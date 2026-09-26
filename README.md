<div align="center">
  <img src="docs/assets/banner.png" width="128" alt="Astravia" />
  <h3>Astravia · 星轨</h3>
  <p><strong>本地优先的开源 AI 桌面助手</strong> — 编码、文档、数据、自动化、设计，一个应用全包；无云端、无账号、无遥测，数据与密钥始终留在你的本机</p>
  <p><b>简体中文</b> · <a href="README.en-US.md">English</a></p>
</div>

---

<p align="center">
  <img src="docs/assets/screenshot-main.png" alt="Astravia 深色主题" width="860" />
</p>

<p align="center">
  <img src="docs/assets/capabilities.png" alt="能力页" width="860" />
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

<table width="100%">
<colgroup><col width="30%"><col width="70%"></colgroup>
<tbody>
<tr><td>服务商预设</td><td>Claude、OpenAI、DeepSeek、Z.ai、Kimi、Gemini、Grok、Qwen — 预设只含 baseUrl 与 API 类型，<b>不含任何 Key</b></td></tr>
<tr><td>Key 与模型同步</td><td>填入 Key 后立即拉取该账号可用模型，之后每 12 小时后台同步一次</td></tr>
<tr><td>请求链路</td><td>直发服务商，应用不代理、不转发、不计费</td></tr>
<tr><td>兼容端点</td><td>支持 OpenAI 兼容协议，可接 Ollama / vLLM / LM Studio 等本地推理服务</td></tr>
<tr><td>元数据来源</td><td>价格与能力由 <a href="https://models.dev">models.dev</a> 补齐，随包带快照兜底，断网仍可使用</td></tr>
</tbody>
</table>

## 网络行为

应用从不主动发起网络请求——每次出站调用都由你明确的配置或操作触发。下表列出所有可能的网络场景：

<table width="100%">
<colgroup><col width="15%"><col width="30%"><col width="55%"></colgroup>
<thead><tr><th>场景</th><th>触发条件</th><th>具体行为</th></tr></thead>
<tbody>
<tr><td>LLM 推理</td><td>你在设置中配置了模型服务商并填入 Key</td><td>请求直发服务商（Claude / OpenAI / DeepSeek / Kimi / Gemini / Grok / Qwen），应用不代理、不转发、不计费。未配置 Key 即完全不发生。</td></tr>
<tr><td>模型元数据</td><td>启动时 + 每 12 小时后台同步</td><td>从 <code>models.dev</code> 拉取价格与能力元数据；网络失败则回退随包内置的快照文件，不影响使用。</td></tr>
<tr><td>能力市场</td><td>你在设置中添加了 GitHub 仓库作为来源</td><td>拉取你指定的仓库 Release，索引 Skill / MCP / 插件 / 主题。未添加任何来源即完全不发生。</td></tr>
<tr><td>自动更新</td><td>更新源由应用配置决定（基于 electron-updater）</td><td>默认从 Cloudflare R2 拉取 <code>latest.yml</code> / <code>latest-mac.yml</code> 检查版本；未配置更新源即不检查。仅下载增量包。</td></tr>
<tr><td>MCP Server</td><td>你在设置中安装了 MCP Server</td><td>按需拉起进程（stdio / http 两种模式），通过你填写的凭据连接远端服务。未安装即完全不发生。</td></tr>
<tr><td>插件</td><td>你在应用内安装了第三方插件</td><td>插件可声明自己的网络行为（Webhook、API 调用等），由宿主运行时校验权限。预装插件无出站网络。</td></tr>
<tr><td>IM 远程控制</td><td>你在设置中启用了飞书机器人并填写凭据</td><td>内嵌 <code>im-gateway</code> Go 边车连接飞书 WebSocket；未启用即不运行。Telegram / 钉钉规划中。</td></tr>
<tr><td>OCR 模型</td><td>首次安装构建时一次性下载</td><td>PP-OCRv5 检测与识别模型（~100MB）下载到本地 <code>resources/ocr-models</code>，之后完全离线。</td></tr>
<tr><td>构建期下载</td><td>开发时执行 <code>bun run build</code></td><td>便携 Python / Node.js 运行时从 <code>python-build-standalone</code> 拉取；dbx 数据库引擎二进制从 GitHub Releases 拉取。</td></tr>
</tbody>
</table>

## 如何开发

### 环境要求

<table width="100%">
<colgroup><col width="20%"><col width="25%"><col width="55%"></colgroup>
<thead><tr><th>依赖</th><th>版本</th><th>用途</th></tr></thead>
<tbody>
<tr><td>Bun</td><td>1.3+</td><td>包管理器与脚本 runner，monorepo 全部使用 Bun，不接受 npm / pnpm</td></tr>
<tr><td>Node.js</td><td>20+</td><td>Vite 前端构建时需要</td></tr>
<tr><td>Go</td><td>1.22+</td><td>仅构建 <code>im-gateway</code> 可选</td></tr>
<tr><td>macOS / Windows</td><td>—</td><td>仅构建桌面宿主可选；Linux 开发者可以完整跑核心库与 CLI</td></tr>
</tbody>
</table>

### 一次性准备

```bash
# 1. 克隆仓库
git clone git@github.com:maomaochong-ai/astravia.git
cd astravia

# 2. 安装所有依赖（monorepo workspace 自动处理）
bun install

# 3. （可选）只构建桌面应用需要的原生模块
bun run build:desktop
```

### 日常开发

```bash
# 启动桌面应用开发模式（热重载 + DevTools）
bun run dev

# 终端 CLI 开发模式
bun run dev:cli

# 只跑某个包的单元测试
bun run test:pkg ai          # test:pkg --list 查看全部包
```

### 提交前检查

```bash
# 完整质量守卫（开 PR 前必跑，失败无法 commit）
bun run check
#   包含：Biome lint + TypeScript 类型检查 + 架构守卫（单向依赖）+ 私钥检测 + 冲突标记检测

# 改动文件的快速反馈（节省时间）
bun run check:quick

# 只跑受改动影响的包的单元测试
bun run test:changed
```

### 提交约定

<table width="100%">
<colgroup><col width="25%"><col width="75%"></colgroup>
<thead><tr><th>约定</th><th>说明</th></tr></thead>
<tbody>
<tr><td>包管理</td><td>统一用 Bun；禁止出现 <code>package-lock.json</code> 或 <code>pnpm-lock.yaml</code></td></tr>
<tr><td>TypeScript</td><td>禁止无必要 <code>any</code>；所有类型错误必须修复才能通过 <code>bun run check</code></td></tr>
<tr><td>i18n</td><td>用户可见文案必须走 i18n，直接写中文 / 英文到组件里是违规的</td></tr>
<tr><td>提交信息</td><td>中文，<code>feat:</code> / <code>fix:</code> / <code>docs:</code> / <code>refactor:</code> / <code>chore:</code> 开头；用 <code>fixes #N</code> / <code>closes #N</code> 关联工单</td></tr>
</tbody>
</table>

完整规范见 [AGENTS.md](AGENTS.md)。

### 可选模块构建

```bash
# CLI 封装
bun run build:cli

# IM 旁路网关（Go，独立 Makefile）
cd packages/im-gateway && make build

# OCR 模型（首次构建会自动下载）
bun run prepare:ocr-models
```

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

**依赖方向**：

<table width="100%">
<colgroup><col width="40%"><col width="60%"></colgroup>
<thead><tr><th>链路</th><th>说明</th></tr></thead>
<tbody>
<tr><td><code>desktop-app</code> / <code>cli-app</code> → <code>runtime-*</code> → <code>coding-agent</code> / <code>agent</code> / <code>ai</code></td><td>宿主不直接调用 AI 层，统一经 runtime 适配层注入</td></tr>
<tr><td><code>ai</code> ← <code>agent</code> ← <code>coding-agent</code></td><td>上层包持有下层能力，coding-agent 是最上层的业务包</td></tr>
<tr><td><code>runtime-*</code> 不依赖 AI 层</td><td>runtime 只适配宿主能力，capability-* 跨层提供权限定义</td></tr>
<tr><td><code>plugins</code> / <code>skill-presets</code> / <code>themes</code></td><td>纯粹的资源包，无运行时依赖</td></tr>
</tbody>
</table>

## 加入社群

<div align="center">
  <table width="100%">
    <tr>
      <td align="center"><img src="docs/assets/community/qq-group.png" width="220" alt="QQ 群" /><p>QQ 群</p></td>
      <td align="center"><img src="docs/assets/community/wechat-group.png" width="220" alt="微信群" /><p>微信群</p></td>
    </tr>
  </table>
  <p>扫码加入社群，交流使用经验、反馈问题、获取最新动态。</p>
</div>

## 致谢

<table width="100%">
<colgroup><col width="25%"><col width="50%"><col width="25%"></colgroup>
<thead><tr><th>项目</th><th>用途</th><th>许可</th></tr></thead>
<tbody>
<tr><td>pi · Mario Zechner</td><td>ai / agent / coding-agent 在其基础上重写与迭代</td><td>MIT</td></tr>
<tr><td>Codex CLI · OpenAI</td><td>执行沙箱方案借鉴其设计</td><td>Apache-2.0</td></tr>
<tr><td>bubblewrap</td><td>Linux 沙箱后端</td><td>LGPL-2.0+</td></tr>
<tr><td>PP-OCRv5 · PaddlePaddle</td><td>离线 PDF OCR</td><td>Apache-2.0</td></tr>
<tr><td>dbx</td><td>数据库引擎</td><td>Apache-2.0</td></tr>
<tr><td>python-build-standalone / Node.js</td><td>便携运行时</td><td>见原仓库</td></tr>
</tbody>
</table>

感谢 [Model Context Protocol](https://modelcontextprotocol.io) 规范与 [models.dev](https://models.dev) 公共模型目录。第三方完整清单见 [NOTICE](NOTICE)。

## 许可

[Apache-2.0](LICENSE)
