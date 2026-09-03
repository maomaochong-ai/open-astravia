# 权限

插件必须在 `plugin.json` 的 `permissions` 数组里声明它要用的宿主 API。宿主在插件管理页**单独授权**，并在运行时校验。

> 权限是能力声明、用户知情同意和宿主 API 门控规范，**不是安全沙箱**。插件与宿主共享 renderer realm；请只安装和启用可信插件。

## 声明 → 授权 → 校验

1. **声明**：`plugin.json` 列出权限。未声明的权限永远拿不到。
2. **授权**：用户在设置 → 插件页为该插件勾选授权（系统插件自动全量授予、不可撤，见 [system-plugins.md](./system-plugins.md)）。Agent 经 `install-from-path` 安装时，确认后可**按声明一次授予**（见 [getting-started.md](./getting-started.md#安装)）。
3. **校验**：调用受门控的 API 时运行时检查；**未授权**会按下表两种方式之一处理。

更新插件（包括 GitHub 能力市场）保留用户已授予且新版本仍声明的权限，不自动授予新增权限，也不恢复用户撤销的权限。
若旧版市场更新已清空授权，请在能力详情的「权限」页重新确认所需权限；无需卸载插件或重新授权服务商账号。
宿主无法从空授权记录推断用户原来的选择，因此不会自动全量补授。

```ts
// 运行时也可自查
ctx.permissions.has("fs.read");      // boolean
ctx.permissions.require("fs.read");  // 缺则抛 Plugin permission denied: fs.read
```

## 缺权限的两种行为

不同注册点对「声明了但未授权」的处理不同：

- **抛错（require）**：`registerInputAction`、`registerCardRenderer`、`registerToolCallSlot`、`registerTurnCard`、`registerShortcutScope`、`openActivityTab`、`setActivityTabVisible`、`setPromptAttachment`、`fileExplorer.*`、`agent.registerContinuationProvider`、`agent.registerSystemPromptProvider`、`conversation.*`、`fs.*`、`network.*`、`storage.*`、`media.*`、`ai.*`、`command.run`。缺权限直接抛 `Plugin permission denied: <permission>`，中断该次调用。
- **跳过 + 警告（warn+noop）**：`registerGlobalSlot`、`registerFilePreview`、`registerActivityTab`、`agent.registerTool`、`agent.registerHook`、`appActions.register`。缺权限时静默跳过该贡献并打 `console.warn`，**不影响**插件其它已授权能力。

> 设计上一个缺失权限不应拖垮插件的其它能力——`activate()` 里建议把可选能力的注册各自独立，避免一处 throw 掉整段。

## 已实现权限（有对应 API / 清单面）

| 权限 | 门控 | 文档 |
| --- | --- | --- |
| `ui.slot.global` | `ctx.ui.registerGlobalSlot()` | [ui-slots](./ui-slots.md#全局浮层-registerglobalslot) |
| `ui.slot.workspace-view` | `ctx.ui.registerWorkspaceView()` / `openWorkspaceView()` / `setWorkspaceViewBadge()` | [ui-slots](./ui-slots.md#工作区视图-registerworkspaceview) |
| `ui.slot.file-preview` | `ctx.ui.registerFilePreview()` | [ui-slots](./ui-slots.md#文件预览-registerfilepreview) |
| `ui.slot.activity-tab` | `registerActivityTab` / `openActivityTab` / `setActivityTabVisible` | [ui-slots](./ui-slots.md#活动面板-tab-registeractivitytab) |
| `ui.slot.input-action` | `registerInputAction` / `setPromptAttachment` | [ui-slots](./ui-slots.md#输入栏动作-registerinputaction) |
| `ui.slot.message` | `ctx.ui.registerCardRenderer()` | [message-cards](./message-cards.md) |
| `ui.slot.tool-call` | `ctx.ui.registerToolCallSlot()` | [ui-slots](./ui-slots.md#工具行内渲染-registertoolcallslot) |
| `ui.slot.turn-card` | `ctx.ui.registerTurnCard()` | [ui-slots](./ui-slots.md#本轮-turn-卡-registerturncard) |
| `ui.shortcuts.register` | `ctx.ui.registerShortcutScope()` / `usePluginShortcutScope` | [ui-slots](./ui-slots.md#键盘快捷键-registershortcutscope) |
| `ui.file-explorer.decorations` | `ctx.fileExplorer.registerDecorationProvider()` | [file-explorer](./file-explorer.md#文件装饰) |
| `ui.file-explorer.context-menu` | `ctx.fileExplorer.registerContextMenuAction()` | [file-explorer](./file-explorer.md#右键菜单) |
| `ui.file-explorer.toolbar` | `ctx.fileExplorer.registerToolbarAction()` | [file-explorer](./file-explorer.md#工具栏动作) |
| `workspace.read` | 文件列表查询、定位、刷新与事件 | [file-explorer](./file-explorer.md#工作区选择与定位) |
| `agent.session.read` | `ctx.conversation.on()` + 对话 hook | [conversation-and-agent](./conversation-and-agent.md#对话读状态) |
| `agent.session.write` | `sendPrompt` / `insertText` / `abort` | [conversation-and-agent](./conversation-and-agent.md#对话驾驶) |
| `agent.command.run` | `ctx.command.run` + 清单 `commands` | [conversation-and-agent](./conversation-and-agent.md#命令执行-command) |
| `agent.command.spawn` | `ctx.command.spawn`（长驻进程）+ 清单 `commands` | [conversation-and-agent](./conversation-and-agent.md#长驻进程-commandspawn) |
| `capture.offscreen` | `ctx.capture.offscreen`（主进程离屏窗口截图） | [conversation-and-agent](./conversation-and-agent.md#离屏截图-captureoffscreen) |
| `agent.skills.control` | 清单 `agent.skillPaths` | [manifest](./manifest.md#agent-agent-侧贡献) |
| `agent.mcp.control` | 清单 `agent.mcpServers`（三源聚合之插件源） | [mcp](./mcp.md) |
| `agent.tools.register` | `ctx.agent.registerTool()`（注册 shell） | [conversation-and-agent](./conversation-and-agent.md#注册-agent-工具) |
| `agent.toolHandler.execute` | 工具 handler 被 agent 调用时执行 | 同上 |
| `agent.hooks.register` | `ctx.agent.registerHook()`（注册 Coding Agent 生命周期 Hook） | [conversation-and-agent](./conversation-and-agent.md#注册-coding-agent-hook) |
| `agent.hookHandler.execute` | Coding Agent 到达匹配事件时调用插件 Hook handler | 同上 |
| `agent.tools.control` | 清单 `agent.toolPolicy`；动态 `setToolEnabled` / `actions.tools.*` | [manifest](./manifest.md#agent-agent-侧贡献) / [conversation-and-agent](./conversation-and-agent.md#注册动态系统提示词-provider) |
| `agent.systemPrompt.write` | `registerSystemPromptProvider`；仅本插件 block | [conversation-and-agent](./conversation-and-agent.md#注册动态系统提示词-provider) |
| `agent.systemPrompt.fullControl` | 动态 provider 操作非本插件 block | 同上 |
| `agent.continuation.register` | `registerContinuationProvider` | [conversation-and-agent](./conversation-and-agent.md#注册-agent-自动续跑策略) |
| `app.actions.register` | `ctx.appActions.register()`（注册声明） | [app-actions](./app-actions.md) |
| `app.actionHandler.execute` | Action handler 被本地 Action RPC 调用时执行 | 同上 |
| `fs.read` | `readDir` / `readFile` / `stat` / `listFilesRecursive` | [conversation-and-agent](./conversation-and-agent.md#文件-api) |
| `fs.write` | `writeFile` / `rename` / `delete` / `move` / `createDirectory` | 同上 |
| `network.fetch` | `ctx.network.request` | [conversation-and-agent](./conversation-and-agent.md#网络-api) |
| `browser.read` | 创建/查询/关闭 session，导航、快照、文本与截图 | [browser](./browser.md) |
| `browser.open` | `ctx.browser.open`；仅打开宿主内置 Browser Panel，不读取或操作页面 | [browser](./browser.md) |
| `browser.interact` | `ctx.browser.act`；必须同时声明 `browser.read` | [browser](./browser.md) |
| `browser.profile.persist` | 创建宿主管理的持久 profile | [browser](./browser.md#多账号-profile) |
| `browser.attach` | 附着用户自行开启调试的 Chrome | [browser](./browser.md) |
| `browser.runtime.manage` | 安装/修复浏览器运行时 | [browser](./browser.md) |
| `storage.read` | `ctx.storage.readJson/list/readFile/readBlob/getBlobRef` | [conversation-and-agent](./conversation-and-agent.md#插件私有存储-api) |
| `storage.write` | `ctx.storage.writeJson/writeFile/putBlob` | 同上 |
| `media.generate` | `ctx.media.listProviders/createJob/getJob/cancelJob` | [media](./media.md) |
| `media.provider.register` | `ctx.media.registerProvider`（注册媒体 Provider） | [media](./media.md#注册-provider) |
| `ai.models.list` | `ctx.ai.listModels()` | [ai](./ai.md) |
| `ai.complete` | `ctx.ai.complete()` / `ctx.ai.chat()` | [ai](./ai.md) |

> `ctx.settings` / `ctx.i18n` / **`ctx.ui.notify`** **不需要权限**——分别读本插件设置命名空间、本插件 catalog、以及向宿主右下角推送 Toast（含错误堆栈复制）。错误上报规范见 [ui-slots → notify](./ui-slots.md#全局通知-notify)。

## 占位符权限（已声明、暂无对应 API）

`PluginPermission` 联合里还包含以下值，目前是**声明了但还没对应能力 API** 的占位符，现在声明它们不会解锁任何功能：

`agent.systemPrompt.read`、`agent.state.read`、`agent.state.write`、`agent.runtime.configure`、`settings.read`、`settings.write`。

## 最小授权原则

只声明真正用到的权限。`permissions` 越小，用户授权越省心、审核越快。

使用 `@vetta-org/plugin-vite` 构建或执行 `vetta-plugin pack` 时，构建器会检查最终 JavaScript
产物和 `plugin.json` 的能力声明；发现 `registerSystemPromptProvider`、`setToolEnabled`、
`registerTool`、`registerHook` 等能力缺少对应权限时会直接终止构建。运行时权限校验仍然保留，
用于验证用户是否实际授权并约束通过宿主公开 API 发起的调用。
