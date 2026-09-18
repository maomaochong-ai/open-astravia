# Vetta 桌面插件开发手册

面向第三方开发者的 Vetta 桌面端插件**对接与开发**完整手册。读完本目录你应当能从零写出、打包、安装、调试一个插件，并用上所有可用扩展点。

> 插件运行在 Vetta 桌面 App（Electron）的 renderer 进程内，与宿主共享 JavaScript realm——**没有安全沙箱**。只安装并启用你信任的插件。`@vetta-org/plugin-sdk` 权限用于声明与门控宿主 API，不承诺隔离恶意代码（见 [信任模型](#信任模型)）。

> **这份手册是随 `@vetta-org/plugin-sdk` 装进 `node_modules` 的快照**，版本与本工程实际编译的 SDK 一致——这正是它的价值：它不会教你写宿主还不支持的东西。代价是工程不升级 SDK，它就永远停在初始化那天。开工前确认一次：
>
> ```bash
> npx vetta-plugin-cli docs --check-latest
> ```
>
> 落后就按它打印的命令升级 SDK 并重读。`docs` 的输出永远比手册和 `AGENTS.md` 新（`npx` 默认取最新的 CLI），冲突时以它为准。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [getting-started.md](./getting-started.md) | 环境、脚手架、Vite/Module Federation、构建、安装（含本地路径）、调试闭环 |
| [logging.md](./logging.md) | **插件持久化日志**：自动绑定插件身份、子作用域、结构化字段、隐私与版本要求 |
| [ability-details.md](./ability-details.md) | **能力详情页**：`ability.json`、结构化区块、Markdown 文件引用、多语言、资源打包与限制 |
| [guiding-the-agent.md](./guiding-the-agent.md) | **引导模型用好你的扩展**：三层心智模型、name/description 正反触发段、返回值引导、skill 渐进披露、执行边界、反模式与自检清单 |
| [manifest.md](./manifest.md) | `plugin.json` 全字段、`commands`、`contributionMode`、`agent_mode`（已废弃）、`defaultLocale` / i18n、settings、guidingWords、agent 贡献、**贡献智能体与团队** |
| [mcp.md](./mcp.md) | **MCP 三源聚合**、插件内聚 MCP（`agent.mcpServers`）、命名、生命周期、打包 |
| [permissions.md](./permissions.md) | 权限完整清单、门控点、声明/授权流程 |
| [ai.md](./ai.md) | 调用用户已配置的文本模型，模型列表、完成请求与凭据边界 |
| [browser.md](./browser.md) | 宿主管理的浏览器 session、持久 profile、多账号隔离、域名范围与类型化动作 |
| [file-explorer.md](./file-explorer.md) | 文件列表右键菜单、工具栏、装饰、定位、刷新与事件 |
| [ui-slots.md](./ui-slots.md) | **notify 全局 Toast** / 文件预览（**含大文件 getUrl 规范**）/ 全局浮层 / **工作区视图（整页）** / 活动 Tab / 输入栏动作 / **新会话上下文区** / **Turn 卡** / **Tool-call 槽** |
| [message-cards.md](./message-cards.md) | 消息卡片：`details.cards`、`registerCardRenderer`、`pendingFor`、跨轮去重 |
| [conversation-and-agent.md](./conversation-and-agent.md) | 对话、registerTool、**registerHook**、command.run、fs、network、storage、settings、i18n、工作模式 getAgentMode |
| [app-actions.md](./app-actions.md) | 动态 App Action：JSON Schema、审批、生命周期、取消与独立发布 |
| [system-plugins.md](./system-plugins.md) | 系统插件（presets）、租户打包 |
| [styling-and-pitfalls.md](./styling-and-pitfalls.md) | 样式、MF 顶层 JSX 陷阱、缓存与 version bump |

工程里的 `AGENTS.md` 只负责把你引到这里，**规则一条都不写在那儿**——它是工程创建那天的快照，不会自更新。红线与合同都以本手册为准。

## 不可违反的红线

写任何代码之前先过一遍。每条都在正文里有详细章节，这里只给判据与去处。

| 红线 | 为什么 | 详见 |
| --- | --- | --- |
| **样式只用 Tailwind `className`** | 插件与宿主共享同一个页面。在 `style.css` 里写 `button` / `div` / `*` 这类选择器会污染整个 UI，而且是只在用户机器上复现的那种污染 | [styling-and-pitfalls](./styling-and-pitfalls.md#样式隔离正常写-tailwind-或-css) |
| **可能失败的路径必须上报用户** | 读文件、解析、网络、外部库的 `catch` 里调用 `ctx.ui.notify({ message, error })`（无需权限）。只写死一句「失败」并丢掉原始 error，用户和你都失去了唯一的线索 | [styling-and-pitfalls](./styling-and-pitfalls.md#错误必须上报用户notify) |
| **权限按需最小声明** | 构建期会校验产物用到的能力与 `plugin.json` 是否匹配，缺了直接构建失败。**但 UI 槽位不在这条校验里**——那类缺权限在运行时只是静默跳过，得对着文档核对 | [permissions](./permissions.md) |
| **顶层不要出现依赖共享 React 的 JSX** | Module Federation 的加载时序问题。放进组件或 `activate` 内 | [styling-and-pitfalls](./styling-and-pitfalls.md#module-federation-顶层-jsx-陷阱) |
| **不要写 `agent_mode`** | 已废弃，无运行时语义。想收窄某个工具的使用场景，把「何时不该用它 + 替代做法」写进该工具 description 的反向触发段 | [guiding-the-agent](./guiding-the-agent.md#3-description-反向触发段在选择前说明边界) |
| **依赖用 registry 上已发布的 semver** | 不要 `workspace:*`——那是仓库内插件专用的，发出去的包在用户机器上装不上 | [getting-started](./getting-started.md#2-packagejson) |
| **目录市场发布要有构建制品** | 旧版 GitHub 市场通过仓库目录安装时，宿主直接读 `entry` 与 `styles`；新版 schema v3 可把 ZIP 发布为独立制品，市场仓库只保留元数据 | [getting-started](./getting-started.md#6-构建与打包) |
| **信息不足时问用户** | 插件 id、展示名、要用哪些权限、功能边界、是否立刻安装——不要自己假定 | — |

## 插件能做什么

一个插件在 `activate(ctx)` 里通过 `ctx` 注册贡献、调用能力；也可在 `plugin.json` **声明式**贡献（skills / MCP / guidingWords / commands…）。

| 能力 | 入口 | 权限 | 文档 |
| --- | --- | --- | --- |
| **全局 Toast / 错误通知** | `ctx.ui.notify` | 无 | [ui-slots](./ui-slots.md#全局通知-notify) |
| **持久化诊断日志** | `logger`（`@vetta-org/plugin-sdk/logger`） | 无 | [logging](./logging.md) |
| 全局浮层 UI | `ctx.ui.registerGlobalSlot` | `ui.slot.global` | [ui-slots](./ui-slots.md#全局浮层-registerglobalslot) |
| **工作区视图**（整页 + 侧边栏入口） | `ctx.ui.registerWorkspaceView` | `ui.slot.workspace-view` | [ui-slots](./ui-slots.md#工作区视图-registerworkspaceview) |
| 文件预览 | `ctx.ui.registerFilePreview` | `ui.slot.file-preview` | [ui-slots](./ui-slots.md#文件预览-registerfilepreview) |
| 文件列表扩展 | `ctx.fileExplorer.*` | `ui.file-explorer.*` / `workspace.read` | [file-explorer](./file-explorer.md) |
| 活动面板 Tab | `ctx.ui.registerActivityTab` / `openActivityTab` | `ui.slot.activity-tab` | [ui-slots](./ui-slots.md#活动面板-tab-registeractivitytab) |
| 输入栏动作（toggle） | `ctx.ui.registerInputAction` | `ui.slot.input-action` | [ui-slots](./ui-slots.md#输入栏动作-registerinputaction) |
| **新会话上下文区**（输入框下方的素材区） | `ctx.ui.registerNewSessionContext` | `ui.slot.new-session-context` | [ui-slots](./ui-slots.md#新会话上下文区-registernewsessioncontext) |
| 消息卡片渲染器 | `ctx.ui.registerCardRenderer` | `ui.slot.message` | [message-cards](./message-cards.md) |
| 工具行内渲染替换 | `ctx.ui.registerToolCallSlot` | `ui.slot.tool-call` | [ui-slots](./ui-slots.md#工具行内渲染-registertoolcallslot) |
| 本轮 Turn 卡 | `ctx.ui.registerTurnCard` | `ui.slot.turn-card` | [ui-slots](./ui-slots.md#本轮-turn-卡-registerturncard) |
| **键盘快捷键（宿主 scope 栈）** | `ctx.ui.registerShortcutScope` / `usePluginShortcutScope` | `ui.shortcuts.register` | [ui-slots](./ui-slots.md#键盘快捷键-registershortcutscope) |
| 读对话 / 事件 | hooks + `ctx.conversation.on` | `agent.session.read` | [conversation-and-agent](./conversation-and-agent.md#对话读状态) |
| 驾驶对话 | `ctx.conversation.sendPrompt/insertText/abort` | `agent.session.write` | [conversation-and-agent](./conversation-and-agent.md#对话驾驶) |
| 注册 Agent 工具 | `ctx.agent.registerTool` | `agent.tools.register` + `execute` | [conversation-and-agent](./conversation-and-agent.md#注册-agent-工具) |
| 注册 Coding Agent Hook | `ctx.agent.registerHook` | `agent.hooks.register` + `agent.hookHandler.execute` | [conversation-and-agent](./conversation-and-agent.md#注册-coding-agent-hook) |
| 注册 App Action | `ctx.appActions.register` | `app.actions.register` + `app.actionHandler.execute` | [app-actions](./app-actions.md) |
| 跑宿主命令 | `ctx.command.run` + 清单 `commands` | `agent.command.run` | [conversation-and-agent](./conversation-and-agent.md#命令执行-command) |
| 长驻进程（dev server 等） | `ctx.command.spawn` + 清单 `commands` | `agent.command.spawn` | [conversation-and-agent](./conversation-and-agent.md#长驻进程-commandspawn) |
| 离屏窗口截图（真实渲染管线） | `ctx.capture.offscreen` | `capture.offscreen` | [conversation-and-agent](./conversation-and-agent.md#离屏截图-captureoffscreen) |
| 读写文件 | `ctx.fs.*` | `fs.read` / `fs.write` | [conversation-and-agent](./conversation-and-agent.md#文件-api) |
| 宿主代理网络请求 | `ctx.network.request` | `network.fetch` | [conversation-and-agent](./conversation-and-agent.md#网络-api) |
| 宿主管理的浏览器自动化 | `ctx.browser.*` | `browser.*` | [browser](./browser.md) |
| 插件私有持久化 | `ctx.storage.*` | `storage.read` / `storage.write` | [conversation-and-agent](./conversation-and-agent.md#插件私有存储-api) |
| 调用用户 AI 模型（单轮/多轮+插件内部工具） | `ctx.ai.listModels/complete/chat` | `ai.models.list` / `ai.complete` | [ai](./ai.md) |
| 读写自身密钥 | `ctx.secrets.*` | `secrets.read` / `secrets.write` | [conversation-and-agent](./conversation-and-agent.md#密钥-api) |
| 插件 i18n | `ctx.i18n` / `useTranslation` + `locales/` | 无（catalog 随包） | [conversation-and-agent](./conversation-and-agent.md#插件-i18n) / [manifest](./manifest.md#i18n) |
| 新会话引导词 | `plugin.json` `guidingWords` | 无 | [manifest](./manifest.md#guidingwords引导词) |
| 打包 skill | `agent.skillPaths` | `agent.skills.control` | [manifest](./manifest.md#agent-agent-侧贡献) |
| **贡献智能体 / 团队** | `plugin.json` `agent.agents` / `agent.teams` | 无 | [manifest](./manifest.md#贡献智能体与团队) |
| **插件内聚 MCP（三源聚合之一）** | `agent.mcpServers` | `agent.mcp.control` | [mcp](./mcp.md) |
| 动态 system prompt | `registerSystemPromptProvider` | `agent.systemPrompt.*` | [conversation-and-agent](./conversation-and-agent.md#注册动态系统提示词-provider) |
| 自动续跑 | `registerContinuationProvider` | `agent.continuation.register` | [conversation-and-agent](./conversation-and-agent.md#注册-agent-自动续跑策略) |
| 贡献硬隔离模式 | `hardIsolation` / `contributionMode` | — | [ui-slots](./ui-slots.md#插件贡献硬隔离-hardisolation) / [manifest](./manifest.md#contributionmode) |
| **工作模式鉴别**（展示层定制；`agent_mode` 声明已废弃） | `ctx.getAgentMode` / `onAgentModeChanged` | 无 | [manifest](./manifest.md#agent_mode已废弃) / [conversation-and-agent](./conversation-and-agent.md#工作模式agent_mode) |

## 信任模型

- 插件按用户明确选择的**可信代码**处理，可以来自官方、市场或本地安装；宿主不把未知第三方代码自动提升为可信。
- 插件跑在 renderer 进程内，经 Module Federation 与宿主**共享同一份 React / React DOM / `@vetta-org/plugin-sdk` 单例**；可选再共享 **`@vetta-org/ui`** 设计系统 primitives（见 [styling-and-pitfalls](./styling-and-pitfalls.md#可选vettaui-宿主-primitives)）。
- SDK 提供宿主能力出口与权限门控，可同步传递 React 组件并读取宿主公开状态，**刻意不做** iframe/worker 沙箱与异步消息桥。
- 每项公开能力由 `plugin.json` 声明权限、宿主单独授权、运行时校验；缺权限会抛 `Plugin permission denied: <permission>` 或 warn+noop（见 [permissions.md](./permissions.md)）。这套机制服务于知情同意、治理和误用防护，不阻止同 realm 插件绕过 SDK 使用浏览器原生能力。

## 5 分钟速览

```tsx
import { definePlugin } from "@vetta-org/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    ctx.ui.registerGlobalSlot({ id: "root", component: MyPanel });
  },
  deactivate() {
    // 可选：清理副作用。注册返回的 Disposable 已由宿主在卸载时统一处置
  },
});
```

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "pluginApiVersion": "^2.0.0",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": { "remoteName": "my_plugin", "expose": "./plugin" },
  "styles": ["dist/style.css"],
  "permissions": ["ui.slot.global"]
}
```

接下来从 [getting-started.md](./getting-started.md) 开始。
