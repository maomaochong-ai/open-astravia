# Vetta 桌面插件开发手册

面向第三方开发者的 Vetta 桌面端插件**对接与开发**完整手册。读完本目录你应当能从零写出、打包、安装、调试一个插件，并用上所有可用扩展点。

> 插件运行在 Vetta 桌面 App（Electron）的 renderer 进程内。它们是**可信、一方/策展**的扩展（经审核上架），共享宿主的 React 单例——**没有沙箱**。所有能力都通过 `@vetta-org/plugin-sdk` 的「策展能力出口 + 权限门控」暴露（见 [信任模型](#信任模型)）。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [getting-started.md](./getting-started.md) | 环境、脚手架、Vite/Module Federation、构建、安装（含本地路径）、调试闭环 |
| [manifest.md](./manifest.md) | `plugin.json` 全字段、`commands`、`contributionMode`、**`agent_mode` 工作模式白名单**、`defaultLocale` / i18n、settings、guidingWords、agent 贡献 |
| [mcp.md](./mcp.md) | **MCP 三源聚合**、插件内聚 MCP（`agent.mcpServers`）、命名、生命周期、打包 |
| [permissions.md](./permissions.md) | 权限完整清单、门控点、声明/授权流程 |
| [file-explorer.md](./file-explorer.md) | 文件列表右键菜单、工具栏、装饰、定位、刷新与事件 |
| [ui-slots.md](./ui-slots.md) | **notify 全局 Toast** / 文件预览（**含大文件 getUrl 规范**）/ 全局浮层 / 活动 Tab / 输入栏动作 / **Turn 卡** / **Tool-call 槽** |
| [message-cards.md](./message-cards.md) | 消息卡片：`details.cards`、`registerCardRenderer`、`pendingFor`、跨轮去重 |
| [conversation-and-agent.md](./conversation-and-agent.md) | 对话、registerTool、**command.run**、fs、network、storage、settings、**i18n**、**工作模式 getAgentMode** |
| [app-actions.md](./app-actions.md) | 动态 App Action：JSON Schema、审批、生命周期、取消与独立发布 |
| [system-plugins.md](./system-plugins.md) | 系统插件（presets）、租户打包 |
| [styling-and-pitfalls.md](./styling-and-pitfalls.md) | 样式、MF 顶层 JSX 陷阱、缓存与 version bump |

## 插件能做什么

一个插件在 `activate(ctx)` 里通过 `ctx` 注册贡献、调用能力；也可在 `plugin.json` **声明式**贡献（skills / MCP / guidingWords / commands…）。

| 能力 | 入口 | 权限 | 文档 |
| --- | --- | --- | --- |
| **全局 Toast / 错误通知** | `ctx.ui.notify` | 无 | [ui-slots](./ui-slots.md#全局通知-notify) |
| 全局浮层 UI | `ctx.ui.registerGlobalSlot` | `ui.slot.global` | [ui-slots](./ui-slots.md#全局浮层-registerglobalslot) |
| 文件预览 | `ctx.ui.registerFilePreview` | `ui.slot.file-preview` | [ui-slots](./ui-slots.md#文件预览-registerfilepreview) |
| 文件列表扩展 | `ctx.fileExplorer.*` | `ui.file-explorer.*` / `workspace.read` | [file-explorer](./file-explorer.md) |
| 活动面板 Tab | `ctx.ui.registerActivityTab` / `openActivityTab` | `ui.slot.activity-tab` | [ui-slots](./ui-slots.md#活动面板-tab-registeractivitytab) |
| 输入栏动作（toggle） | `ctx.ui.registerInputAction` | `ui.slot.input-action` | [ui-slots](./ui-slots.md#输入栏动作-registerinputaction) |
| 消息卡片渲染器 | `ctx.ui.registerCardRenderer` | `ui.slot.message` | [message-cards](./message-cards.md) |
| 工具行内渲染替换 | `ctx.ui.registerToolCallSlot` | `ui.slot.tool-call` | [ui-slots](./ui-slots.md#工具行内渲染-registertoolcallslot) |
| 本轮 Turn 卡 | `ctx.ui.registerTurnCard` | `ui.slot.turn-card` | [ui-slots](./ui-slots.md#本轮-turn-卡-registerturncard) |
| **键盘快捷键（宿主 scope 栈）** | `ctx.ui.registerShortcutScope` / `usePluginShortcutScope` | `ui.shortcuts.register` | [ui-slots](./ui-slots.md#键盘快捷键-registershortcutscope) |
| 读对话 / 事件 | hooks + `ctx.conversation.on` | `agent.session.read` | [conversation-and-agent](./conversation-and-agent.md#对话读状态) |
| 驾驶对话 | `ctx.conversation.sendPrompt/insertText/abort` | `agent.session.write` | [conversation-and-agent](./conversation-and-agent.md#对话驾驶) |
| 注册 Agent 工具 | `ctx.agent.registerTool` | `agent.tools.register` + `execute` | [conversation-and-agent](./conversation-and-agent.md#注册-agent-工具) |
| 注册 App Action | `ctx.appActions.register` | `app.actions.register` + `app.actionHandler.execute` | [app-actions](./app-actions.md) |
| 跑宿主命令 | `ctx.command.run` + 清单 `commands` | `agent.command.run` | [conversation-and-agent](./conversation-and-agent.md#命令执行-command) |
| 读写文件 | `ctx.fs.*` | `fs.read` / `fs.write` | [conversation-and-agent](./conversation-and-agent.md#文件-api) |
| 宿主代理网络请求 | `ctx.network.request` | `network.fetch` | [conversation-and-agent](./conversation-and-agent.md#网络-api) |
| 插件私有持久化 | `ctx.storage.*` | `storage.read` / `storage.write` | [conversation-and-agent](./conversation-and-agent.md#插件私有存储-api) |
| 读自身设置 | `ctx.settings.*` | 无 | [conversation-and-agent](./conversation-and-agent.md#设置-api) |
| 插件 i18n | `ctx.i18n` / `useTranslation` + `locales/` | 无（catalog 随包） | [conversation-and-agent](./conversation-and-agent.md#插件-i18n) / [manifest](./manifest.md#i18n) |
| 新会话引导词 | `plugin.json` `guidingWords` | 无 | [manifest](./manifest.md#guidingwords引导词) |
| 打包 skill | `agent.skillPaths` | `agent.skills.control` | [manifest](./manifest.md#agent-agent-侧贡献) |
| **插件内聚 MCP（三源聚合之一）** | `agent.mcpServers` | `agent.mcp.control` | [mcp](./mcp.md) |
| 动态 system prompt | `registerSystemPromptProvider` | `agent.systemPrompt.*` | [conversation-and-agent](./conversation-and-agent.md#注册动态系统提示词-provider) |
| 自动续跑 | `registerContinuationProvider` | `agent.continuation.register` | [conversation-and-agent](./conversation-and-agent.md#注册-agent-自动续跑策略) |
| 贡献硬隔离模式 | `hardIsolation` / `contributionMode` | — | [ui-slots](./ui-slots.md#插件贡献硬隔离-hardisolation) / [manifest](./manifest.md#contributionmode) |
| **工作模式(Work/Coding)门控 + 鉴别** | 清单 `agent_mode` / `ctx.getAgentMode` / `onAgentModeChanged` | 无 | [manifest](./manifest.md#agent_mode工作模式白名单) / [conversation-and-agent](./conversation-and-agent.md#工作模式agent_mode) |

## 信任模型

- 插件是**一方 / 策展**的（官方或合作方编写、经审核上架），**不是**任意第三方不可信代码。
- 插件跑在 renderer 进程内，经 Module Federation 与宿主**共享同一份 React / React DOM / `@vetta-org/plugin-sdk` 单例**。
- 因此 SDK 是「**策展过的能力出口 + 权限门控**」——可同步、可直接传 React 组件实例、可读宿主状态，**刻意不做** iframe/worker 沙箱与异步消息桥。
- 每项能力由 `plugin.json` 声明权限、宿主单独授权、运行时校验；缺权限会抛 `Plugin permission denied: <permission>` 或 warn+noop（见 [permissions.md](./permissions.md)）。

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
  "pluginApiVersion": "^1.0.0",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": { "remoteName": "my_plugin", "expose": "./plugin" },
  "styles": ["dist/style.css"],
  "permissions": ["ui.slot.global"]
}
```

接下来从 [getting-started.md](./getting-started.md) 开始。
