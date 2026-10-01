<div align="center">
  <img src="docs/assets/banner.png" width="128" alt="Astravia" />
  <h3>Astravia · 星轨</h3>
  <p><strong>本地优先的开源 AI 桌面助手</strong> — 编码 · 文档 · 数据 · 自动化 · 设计，一个应用全包</p>
  <p><b>简体中文</b> · <a href="README.md">English</a></p>
</div>

---

<p align="center">
  <table width="100%">
    <tr>
      <td align="center"><img src="docs/assets/screenshot-main.png" alt="Astravia 深色主题" width="100%" /><p><em>主界面：对话、工作区、文件预览同屏可见</em></p></td>
      <td align="center"><img src="docs/assets/capabilities.png" alt="能力页" width="100%" /><p><em>能力中心：所有扩展点随需启用，权限逐条授权</em></p></td>
    </tr>
  </table>
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

## 插件开发

Astravia 自身的设计画布、Git、图表、文件预览都是插件，同一套扩展点对第三方开放。插件用 Vite + Module Federation 构建成独立 bundle，宿主运行时按需加载、沙箱执行、权限校验。

### 能扩展什么

<table width="100%">
<colgroup><col width="25%"><col width="75%"></colgroup>
<thead><tr><th>域</th><th>可用扩展点</th></tr></thead>
<tbody>
<tr><td>界面 (ctx.ui)</td><td>全局悬浮面板、活动面板标签、文件预览器、消息卡片、工具调用插槽、快捷键、通知、文件浏览器工具栏与右键菜单</td></tr>
<tr><td>Agent (ctx.agent)</td><td>注册 JS 工具（JSON Schema 入参）、动态系统提示词 provider、Skill 目录注入、MCP Server 随插件声明、Continuation provider（会话尾自动追问）</td></tr>
<tr><td>宿主能力</td><td>文件读写 (ctx.fs)、命令执行 (ctx.command)、HTTP 请求 (ctx.network)、持久化存储 (ctx.storage)、设置页 (ctx.settings)、i18n (ctx.i18n)、官方 API（模型 / 提供商 / MCP / 批量 / 调度…）</td></tr>
<tr><td>权限系统</td><td>每项能力都必须在 plugin.json 的 permissions 中声明，宿主安装时弹窗让用户逐条授权，运行时再次校验</td></tr>
</tbody>
</table>

### 目录结构

```
my-plugin/
├── plugin.json          ← 必须，声明元数据、权限、Agent 贡献路径
├── package.json
├── vite.config.ts       ← 用 @astravia-org/plugin-vite 的 astraviaPluginFederation
├── src/
│   ├── index.tsx        ← 入口，导出 definePlugin({ activate })
│   └── style.css
├── locales/zh.json      ← 可选，i18n 文案
├── agent/
│   └── skills/          ← 可选，随插件打包的 Skill
├── mcp.json             ← 可选，随插件声明的 MCP Server
└── icon.png             ← 可选，列表展示用
```

### plugin.json（最小示例）

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "pluginApiVersion": "^1.0.0",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": { "remoteName": "my_plugin", "expose": "./plugin" },
  "permissions": ["ui.slot.global", "agent.tools.register", "fs.read"],
  "agent": {
    "skillPaths": ["agent/skills/"],
    "mcpServers": {
      "my-mcp": { "type": "stdio", "command": "node", "args": ["mcp.js"] }
    }
  }
}
```

### 入口代码

```tsx
import { definePlugin } from "@astravia-org/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    // 扩展界面
    ctx.ui.registerActivityTab({ id: "my-tab", label: "我的面板", component: MyPanel });

    // 扩展 Agent：注册一个 JS 工具
    ctx.agent.registerTool({
      id: "greet",
      name: "greet_user",
      description: "向用户打招呼",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      handler: async ({ trigger }) => `Hello, ${trigger.input.name}!`,
    });
  },

  deactivate() { /* 可选，卸载时清理 */ },
});
```

### 完整实例：chart-renderer

这就是随 Astravia 应用分发的内置图表插件。它做两件事：注册一个 `render_chart` 的 JS 工具（Agent 调用时生成 Chart.js 图表），并在消息气泡下方渲染图表卡片。

**Step 1 — 目录**

```
chart-renderer/
├── plugin.json
├── package.json        # dependencies: chart.js, react-chartjs-2
├── vite.config.ts      # astraviaPluginFederation({ name: "chart_renderer", entry: "./src/index.tsx" })
├── src/index.tsx       # definePlugin({ activate })
├── src/ChartCard.tsx   # 实际的图表卡片 React 组件
├── src/ToolChartSlot.tsx
├── locales/{zh,en}.json
├── skills/chart-renderer/SKILL.md   # 告诉 Agent 什么时候该调用这个工具
└── icon.png
```

**Step 2 — plugin.json**

```json
{
  "id": "chart-renderer",
  "name": "%plugin.name%",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "permissions": [
    "ui.slot.tool-call",
    "agent.tools.register",
    "agent.toolHandler.execute",
    "agent.skills.control"
  ],
  "agent": { "skillPaths": ["skills/"] }
}
```

重点：`permissions` 只声明实际用到的 4 项，宿主安装时逐条弹窗；`skillPaths` 让 Agent 把插件打包的 SKILL.md 合入自己的技能库。

**Step 3 — src/index.tsx（入口）**

```tsx
import { definePlugin } from "@astravia-org/plugin-sdk";
import { ToolChartSlot } from "./ToolChartSlot";

const parameters = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["line","bar","pie","doughnut"], description: "Chart.js 图表类型" },
    data: { type: "object", description: "标准 Chart.js data（labels + datasets）" },
    title: { type: "string" },
    height: { type: "number", description: "建议 220–520" },
  },
  required: ["type", "data"],
};

export default definePlugin({
  activate(ctx) {
    // 1. 注册工具调用的 UI 插槽 — Agent 调用 render_chart 时，用 ToolChartSlot 组件渲染卡片
    ctx.ui.registerToolCallSlot({
      id: "render-chart-tool-ui",
      toolName: "render_chart",
      component: ToolChartSlot,
    });

    // 2. 注册 JS 工具 — Agent 可以调用它
    ctx.agent.registerTool({
      id: "chart-renderer",
      name: "render_chart",
      label: "渲染图表",
      description: "在对话消息下方渲染一个交互式 Chart.js 图表",
      parameters,
      timeoutMs: 10_000,
      handler: async ({ trigger }) => {
        const { type, data, title, height = 300 } = trigger.input ?? {};
        if (!type || !data) return { ok: false, retryable: true, error: "缺少 type 或 data" };
        return { ok: true, rendered: true, summary: `已渲染 ${title ?? "图表"}` };
      },
    });
  },
});
```

注意两个扩展点的配合：**`registerTool`** 让 Agent 知道有这个能力并会调它，**`registerToolCallSlot`** 告诉宿主"这个工具被调用时，用哪个 React 组件来展示结果"。工具 handler 本身不渲染 UI，只返回结构化数据，UI 渲染由宿主调用 ToolChartSlot 完成。

**Step 4 — 构建打包**

```bash
bun install
bun run build          # 产物 dist/mf-manifest.json + remoteEntry.js + style.css
zip -r chart-renderer.zip .   # 整个目录打包
```

**Step 5 — 安装到 Astravia**

- 开发调试：`bun run dev` 启动桌面应用，把 zip 拖进「设置 → 插件 → 安装本地插件」
- 分发给用户：把 zip 放到 GitHub Release，在插件市场填仓库 URL，宿主自动拉取 + 校验 + 安装

源码位置：`packages/plugins/presets/chart-renderer/`，与 Astravia 主仓库同构，可直接对照。

### 构建与安装

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
bun run build           # 产物：dist/mf-manifest.json + dist/remoteEntry.js + dist/style.css
zip -r my-plugin.zip .  # 打包整个插件目录（含 plugin.json）
```

安装：在 Astravia 内「设置 → 插件 → 安装本地插件」选择 zip 即可。也可以把插件放到 GitHub Release，用仓库 URL 在应用内一键安装。

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

<p align="center" style="color:#656d76;font-size:14px;margin-bottom:20px;">扫码加入，交流使用经验、反馈问题、获取最新动态</p>

<div align="center">
  <table width="100%" style="border-collapse:separate;border-spacing:16px 0;">
    <tr>
      <td align="center" style="border:1px solid #d0d7de;border-radius:12px;padding:20px 16px;background:#f6f8fa;vertical-align:top;">
        <div style="display:inline-block;padding:3px 10px;border-radius:20px;background:#12b7f5;color:#fff;font-size:12px;font-weight:600;margin-bottom:12px;">QQ</div><br />
        <img src="docs/assets/community/qq-group.png" width="200" alt="QQ 群" style="border-radius:6px;" /><br />
        <p style="margin:12px 0 0 0;font-weight:600;font-size:15px;">QQ 官方群</p>
        <p style="margin:4px 0 0 0;color:#656d76;font-size:13px;">日常交流 · 问题反馈</p>
      </td>
      <td align="center" style="border:1px solid #d0d7de;border-radius:12px;padding:20px 16px;background:#f6f8fa;vertical-align:top;">
        <div style="display:inline-block;padding:3px 10px;border-radius:20px;background:#07c160;color:#fff;font-size:12px;font-weight:600;margin-bottom:12px;">微信</div><br />
        <img src="docs/assets/community/wechat-group.jpg" width="200" alt="微信群" style="border-radius:6px;" /><br />
        <p style="margin:12px 0 0 0;font-weight:600;font-size:15px;">微信官方群</p>
        <p style="margin:4px 0 0 0;color:#656d76;font-size:13px;">版本更新 · 内测招募</p>
      </td>
    </tr>
  </table>
</div>

## 致谢

<table width="100%">
<thead><tr><th>项目</th><th>用途</th><th>许可</th></tr></thead>
<tbody>
<tr><td><a href="https://github.com/badlogic/pi-mono">pi</a> · Mario Zechner</td><td><code>ai</code>、<code>agent</code>、<code>coding-agent</code>、<code>ecosystem-adapter</code> 源自该项目，已重写与扩展；Agent 循环、Provider 抽象、扩展机制均脱胎于此</td><td>MIT</td></tr>
<tr><td><a href="https://github.com/openai/codex">Codex CLI</a> · OpenAI</td><td>执行沙箱方案借鉴其设计；Windows 沙箱宿主机二进制随应用分发</td><td>Apache-2.0</td></tr>
<tr><td><a href="https://github.com/containers/bubblewrap">bubblewrap</a></td><td>Linux 沙箱后端 <code>bwrap</code>，随 Linux 安装包分发</td><td>LGPL-2.0+</td></tr>
<tr><td><a href="https://github.com/PaddlePaddle/PaddleOCR">PP-OCRv5</a> · PaddlePaddle</td><td>离线 PDF OCR 检测与识别模型（<code>ppocrv5_det.onnx</code> / <code>ppocrv5_rec.onnx</code>）</td><td>Apache-2.0</td></tr>
<tr><td><a href="https://github.com/astral-sh/python-build-standalone">python-build-standalone</a></td><td>便携 Python 运行时，按需下载分发</td><td>PSF / 混合</td></tr>
<tr><td><a href="https://nodejs.org">Node.js</a></td><td>便携 Node 运行时，按需下载分发</td><td>MIT</td></tr>
</tbody>
</table>

感谢 [Model Context Protocol](https://modelcontextprotocol.io) 规范、[models.dev](https://models.dev) 公共模型目录，以及 Electron、React、Vite、Tailwind CSS、shadcn/ui、Bun 等开源项目。完整第三方清单见 [NOTICE](NOTICE)。

## 许可

[Apache-2.0](LICENSE)
