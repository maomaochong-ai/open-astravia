# Changelog

All notable changes to `@vetta-org/plugin-sdk` are documented in this file.

## [Unreleased]

### Breaking Changes

- `network.fetch` 现在必须同时声明 `plugin.json` 的 `network.allowedHosts`；宿主按域名/IP校验首跳与重定向。私网 IP、localhost 可正常声明，`*` 仅对 official 插件生效。
- Replaced the media protocol v2 task surface with generic operation, job, and artifact APIs: consumers now call `ctx.media.submit()` with a typed `generate | compose | transcode` request, control host-owned work through `ctx.jobs`, and persist or release temporary output through `ctx.artifacts`. Provider registration now uses `submit()`, operation-specific capability declarations, opaque `inputs`, and `uploadInput()`. The old `createJob/getJob/cancelJob/saveArtifact/releaseArtifact` methods were removed without a compatibility layer (ADR-0059).

### Changed

- `setActivityPanelWidth("max")` 与 `openActivityTab(id, { width: "max" })` 的 `"max"` 从「按当前窗口算一次宽度」改为**持续状态**：窗口尺寸变化时宿主重新求值，面板跟着一起变宽变窄，直到用户拖动分隔条或有人写入具体像素为止。传数字的行为不变（仍是一次性的固定宽度）。插件无需改动。

### Added

- **工作区视图 `ctx.ui.registerWorkspaceView()`**（新权限 `ui.slot.workspace-view`）：插件可以贡献一个**整页 surface**，与内置的「自动化」「知识库」同级——宿主给它一条自己的路由 `/workspace/<pluginId>/<viewId>` 和一个侧边栏导航入口，打开后整个内容区归插件。用于跨会话、跨项目的工作台（看板、控制台、仪表盘）；绑定单次对话的辅助 UI 仍应使用 Activity Tab。配套 `ctx.ui.openWorkspaceView(viewId)` 做程序化跳转。视图 `id` 会进 URL 并参与侧边栏布局持久化，故限定为 `^[a-z0-9][a-z0-9._-]*$`；`icon` 是 **iconify class 字符串**而非 ReactNode（宿主要把它渲染进自己的导航按钮并按 key 持久化布局）。导航入口默认落在侧边栏「更多」收纳里，用户可拖拽排序或 pin 到左上方置顶区。见 ADR-0065。
- **`official.sessions`**（仅 official 来源插件可用）：后台会话编排 —— `create` / `prompt` / `abort` / `rename` / `list` / `listRunning` / `onRunningChanged` / `open`。与 `ctx.conversation.*` 的分工是：后者作用于**用户当前正在看的**会话，这套 API 按 sessionId 显式寻址、与当前路由无关。会话本体跑在主进程，创建并 prompt 之后即使宿主停在别的页面、插件 UI 未挂载，agent loop 也会继续跑到自然停止点——这是「多任务并发派单」类工作台成立的前提。见 ADR-0065。
- **宿主成品 UI 组件对插件开放**：新增共享入口 `@vetta/theme-ui/plugin-ui`（Module Federation 共享域，与 `@vetta/ui` 同一机制），插件拿到的是宿主运行时的**同一份实例**，因此不是「长得像」而是同一个组件。首批开放 `ModelSelectorView`（搜索、provider 分组与图标、云端/默认/视觉徽章、推理档位子菜单）、`ProviderIcon`、`MultiplierTag`。全部为纯展示组件：数据、文案、写回逻辑经 props 注入，插件可在自己的语义下复用（看板给「某张卡」选模型，宿主输入栏给「当前会话」选模型）。清单有意收窄，见 `packages/theme-ui/src/plugin-ui`。
- `official.models.list()` 的 provider 摘要新增 `icon`（图标 symbol），配合 `ProviderIcon` 即可渲染出与宿主一致的服务商图标。
- `official.models.list()` 现在返回**用户实际可选的全部模型**：除本地配置的 provider 外，还包含登录后服务端下发的远程目录（Vetta Go 等，摘要上带 `remote: true`），与宿主输入栏模型选择器同一口径；同一个 `provider/modelId` 以本地为准。`assertModelKeyExists` 同步认这些远程 key（此前会误判为不存在，因为主进程只看得到本地模型配置）。
- `official.sessions` 支持指定模型：`create({ cwd, title, modelKey })` 把模型写进新会话的**会话设置**（后续插件 prompt 与用户在对话页手动接管都用它）；`prompt(sessionId, text, { modelKey })` 只钉住这一轮、不改会话设置。两者都可省略，省略即跟随宿主全局默认模型。可选模型清单来自既有的 `official.models.list()`。
- `capture.offscreen` 新增 `probeScript` 与结果字段 `probe`：插件可在**截图的同一时刻**对离屏页面求值，把渲染后的 DOM 度量（换行、裁切、空图标位、边缘错位等）与位图一起取回，无需为了量一次布局再渲染一遍。结果经 JSON 往返；求值抛错或不可序列化时 `probe` 为 `undefined`，位图照常返回——探针是搭车的附加信息，不会成为截图失败的原因。
- `conversation.createSession(cwd, { navigate })`（权限同 `sendPrompt`，即 `agent.session.write`）：在指定 workspace 建一个会话并设为活动会话，resolve 时已可直接 `sendPrompt`。用于宿主此刻**没有活动会话**的场景——用户停在新会话页时 `sendPrompt` 无处可发，此前插件只能干等；现在可以自己起一个。默认跳转到对话页，后台任务可传 `navigate: false`。执行模式跟随宿主当前选择。不做复用判断：已有活动会话时照样新建。与 `official.sessions.create` 的分工是后者按 sessionId 显式寻址、与当前路由无关。
- `conversation.sendPrompt` 返回 `SendPromptResult` 回执（ADR-0060）：空闲时整轮结束后 resolve `{ status: "sent" }`；agent streaming 中 prompt 进入会话队列并立即 resolve `{ status: "queued", queueItemId }`，队列在本轮自然停止点接力消费、被打断/出错后暂停待用户处置。`conversation.on` 新增 `queue-changed` 事件（携 `{ paused, items }`），插件可据此呈现排队条目的真实状态。原 `Promise<void>` 消费方无需改动。
- 媒体 Provider 生成能力新增 `modeCapabilities` 与输入 `role`：Provider 可按模式声明首帧、尾帧、图片/视频/音频参考的类型和数量，以及比例、音频策略；媒体协议升级到 v4。
- `ctx.agent.registerHook()`：ESM / Module Federation 插件可动态注册 Coding Agent 的 12 类原生 Hook 事件，并以 `Disposable` 注销。事件与返回值是判别联合；`PreToolUse`、`PermissionRequest`、`Stop` / `SubagentStop` 提供事件专属结果。新增 `agent.hooks.register` 与 `agent.hookHandler.execute` 双权限；`scope_use` 必填且 fail-closed，支持 `agent_mode` / `toolNames` 过滤、超时与 Main 边界校验（ADR-0064）。
- `PluginActivityTabContribution.keepAliveWhenAvailable`：插件可让有状态 Activity Tab 在切换后继续挂载；`useActivityTab()` 新增 `active`，插件可在标签卡激活时调用既有的 `setActivityPanelWidth()` 等命令式能力。
- 新增 `runtime: "quickjs"` 清单值与宿主声明式 UI 类型：第三方逻辑可在 QuickJS-WASM Worker 中执行，通过可序列化的布局、文本、表单和动作节点贡献 Activity Tab；QuickJS 清单禁止自带 CSS 与 Module Federation metadata（ADR-0061）。
- `PluginStorageApi.putBlobFromFile()`：插件可把用户选择或拖入的真实文件直接交给宿主复制到私有 Blob；preload 负责从 `File` 提取路径，文件字节不进入插件 renderer、不进行 Base64 编码，仍受 `storage.write` 权限约束。
- `PluginPromptAttachment.context` 结构化、版本化 JSON 上下文与 `lifecycle: "sticky"`：插件可把用户当前选择等应用状态作为可校验对象附到输入栏，宿主发送时冻结快照；`definePluginPromptContext()` 提供 JSON 安全与大小校验，旧的 metadata/instructions 一次性附件保持兼容。
- `ctx.ai` 宿主管理的文本推理能力：插件通过 `ai.models.list` 获取可用文本模型，通过 `ai.complete` 调用用户已配置的模型。模型解析、凭据注入与请求执行均留在 Desktop 主进程，插件不会接触 API Key；首版契约提供单轮 `systemPrompt + prompt` 完成、推理级别、温度、最大输出和 token 用量。
- `ctx.media` 宿主媒体协议 v3：支持类型化的生成、工程合成和转码操作；Provider 可从远程 URL、插件 Blob 或工作区文件交付输出，由宿主统一导入为 owner 隔离的临时产物。`onProvidersChanged()` 允许并行激活的消费插件响应 Provider 增删。Desktop 内置的 Vetta 图片 Provider 仍固定在主进程调用网关，插件拿不到 JWT，也不能传任意网关路径（ADR-0059）。
- `ctx.gateway`（`PluginGatewayApi`）：带当前登录身份调用 Vetta 服务端（ADR-0056）。插件只给出**相对 `/api/v1` 的路径**与 JSON body，服务端地址、`Authorization` 与 401 刷新重试全在宿主主进程完成——插件拿不到 token，也拼不出指向其它接口的绝对 URL；把 JWT 交给插件进程等于开放整个 `/api/v1` 的越权面，因此 SDK 不提供「取 token 自己拼」的口子。业务信封由宿主拆开，返回 `{ ok, status, code, message, data }`，配额用尽/档位无权限这类**不抛异常**（它们是常规业务分支，插件应据此渲染引导）。**该字段可选**：只对随包分发的 official 插件挂载，第三方插件读到 `undefined`，使用前必须判空。这样收口的理由不是防越权（服务端档位授权已限定可用模型、消耗的是用户自己的额度），而是防插件偷跑烧光用户配额——在缺少插件签名与审核机制前，「安装时用户确认」形同虚设。

- `PluginUiApi.openExternal(url)`：把链接交给系统默认浏览器（Electron `shell.openExternal`），不是 App 内置的浏览器面板。只接受 `http:`/`https:`，其余协议宿主直接拒绝。需新权限 `shell.openExternal`。
- `ctx.capture.offscreen(options)`（`PluginCaptureApi`，新权限 `capture.offscreen`）：宿主主进程用隐藏离屏窗口加载 http(s) 页面并 `capturePage` 出图。与 DOM 克隆类截图（html-to-image）不同，走真实渲染管线，位图与页面在屏显示逐像素一致；`sessionKey` 复用窗口（url 未变跳过重新加载，SPA 切路由零加载），`prepareScript` / `readyExpression` 对接页面自己的就绪信号，`releaseOffscreen(sessionKey)` 主动释放。窗口闲置自动回收，插件禁用/卸载/重载与 App 退出统一清扫。**该字段可选**：旧宿主上 `ctx.capture` 为 `undefined`，使用前判空。
- Added the public `@vetta-org/plugin-sdk/tailwind-theme.css` host-theme contract for semantic Tailwind colors without importing Desktop component styles.

## [0.1.1] — 2026-08-04

### Added

- Added the public `@vetta-org/plugin-sdk/manifest` contract, including a TypeBox `PluginManifestSchema`, Schema-derived types, runtime parsing, permission constants, resource discovery, and Plugin API compatibility checks shared by tooling and the Desktop host.
- Added plugin keyboard shortcuts on the host `ShortcutScopeStack`: permission `ui.shortcuts.register`, `ctx.ui.registerShortcutScope()`, types (`PluginShortcutScopeContribution` / `PluginShortcutBinding`), and React helper `usePluginShortcutScope()`. Kind is limited to `surface` | `overlay` | `modal` (`app` stays host-only for configurable global actions).
- `ctx.command.spawn(file, args?, options?)`：长驻进程能力（ADR-0054）。返回 `PluginCommandSpawnHandle`（`stop()` / `status()` / `onExit()`），`allocatePort: true` 时宿主分配空闲端口并替换 args/env 中的 `{{PORT}}`。需清单 `commands` 声明 + 新权限 `agent.command.spawn`；进程随插件卸载/禁用/重载与 App 退出统一回收。
- `PluginFsApi.saveAs(defaultFileName, content, encoding?, options?)`：经宿主原生保存对话框把内存字节写到用户选定的路径，返回保存路径（用户取消返回 `null`）。与 `writeFile` 不同，目标不受工程根限制——路径由用户当场在原生框里确认，插件无法静默写盘。需 `fs.write` 权限。
- `PluginUiApi.copyImage(dataUrl)`：把 `data:image/...` 写入系统剪贴板，走 Electron 原生剪贴板，不依赖渲染进程的 `ClipboardItem` 支持。无需权限。
- `PluginUiApi.setActivityPanelWidth(width)`：命令式设置活动面板宽度（像素或 `"max"`，宿主 clamp）。与 `openActivityTab(id, { width })` 只在首次 attach 生效不同，这个每次调用都生效，供插件在自己的标签卡被激活时按需占宽。需 `ui.slot.activity-tab` 权限。
- `ConversationEvent` 的 `tool-call-start` 新增可选 `args` 透传（工具入参，如 Edit/Write 的目标路径），供插件做定向 UI（如设计画布的「修改中」态）。

## [0.1.0] — 2026-07-31

### Breaking Changes

- Removed `pendingInstall` from `PluginOfficialUpdaterState`; the `ready` phase is now the single source of truth, and downloaded updates are installed by `electron-updater` when the app quits.
- Replaced the image-specific `PluginContext.images` / `images.generate` surface with generic `PluginContext.network` and plugin-private `PluginContext.storage` capabilities and their `network.fetch`, `storage.read`, and `storage.write` permissions.
- Replaced image-specific prompt attachment APIs with `PluginUiApi.setPromptAttachment()` and `usePromptAttachment()`.

### Added

- Added `PluginContext.fileExplorer` with context-menu, toolbar and decoration contributions; workspace/selection snapshots; reveal/refresh commands; selection and file-change events; and four independently grantable file-explorer permissions.
- Added `PluginActivityTabContribution.initiallyVisible` (default `true`): a registered tab is in the tab bar by default; declare `false` to own its appearance condition and drive it with `setActivityTabVisible` / `openActivityTab`.
- Added `PluginUiApi.setActivityTabVisible(tabId, visible)`: puts one of the plugin's own activity tabs into (or out of) the current conversation's tab bar without activating it or expanding the panel — the counterpart to `openActivityTab`, which is "the user wants to look at it now". Plugins own their tab's appearance condition with it (git only inside a work tree, the workbench following its input-action toggle).
- `PluginConversationApi.on()` now replays one `conversation-changed` with the current state right after subscribing (in a microtask), so cwd-keyed logic runs without waiting for the next session switch.
- Documented `PluginAgentToolRegistration.label` as host-only UI display name supporting `%catalogKey%` plugin i18n (not sent to the model).
- Added hidden per-turn prompt instructions through `PluginPromptDecoration.instructions` and generic `PluginPromptAttachment.instructions`, allowing plugins to own intent guidance without coding-agent domain metadata.
- Added `PluginFsApi.readBinaryFile()` for bounded, host-validated binary reads with MIME detection.
- Added `PluginFsApi.watchDirectory()` and `PluginUiApi.captureRegion()` so plugins can watch approved directories and save captures without accessing the Desktop preload API directly.
- Added `ok` and `statusText` to host-mediated network responses.

## [0.0.4] — 2026-07-23

### Changed

- Split `src/index.ts` into domain modules (`scenario`, `permissions`, `ui`, `agent`, `official`, `hooks`, …); package public API is unchanged and still re-exported from `@vetta-org/plugin-sdk`.
- Tightened Plugin API 1.1 contracts for official batch-task and scheduler mutations, required system-plugin metadata, and approval operation mappings with explicitly allowed alternative presentations.

### Added

- Added work-mode (`agent_mode`) support: `AgentMode` type, `ctx.getAgentMode()` / `ctx.onAgentModeChanged()`, optional `agent_mode` on `PluginAgentToolRegistration` and `PluginMcpServerConfig`, plus plugin-level `agent_mode` in the manifest (ADR-0046).
- Added `ctx.appActions.register()` and its typed JSON Schema Action registration, trusted-official `publicId`, effect, handler, cancellation, and lifecycle contracts.
- Added trust-gated `ctx.official.general.getSettings()` / `setSettings()` host capabilities and official-only host approval presentation mappings for the official Action plugin.
- Added plugin Action `assertReady`, structured `PluginAppActionError`, and trusted official host capabilities for the agent, downloads, updater, and webhook migration domains.
- Extended `ctx.official` with skills、shortcuts、im、mcp、models、projects、knowledge、plugins host capabilities for the next official App Action migration batch.
- Extended `ctx.official` with batchTasks、scheduler、appearance、navigation host capabilities to finish migrating remaining Desktop App Action domains.

## [0.0.2] — 2026-07-15

### Added

- **`PluginUiApi.notify` / `PluginNotifyOptions`**：插件可向宿主右下角全局 Toast 推送通知；传入 `error` 时宿主提供一键「复制堆栈」（含 pluginId@version）。无需权限。

## [0.0.1] — 2026-07-14

### Changed

- **npm 包名**：由 `@vetta/plugin-sdk` 更名为 `@vetta-org/plugin-sdk`（发布 scope 与 org `vetta-org` 对齐）。
- 会话页插槽（活动面板插件标签卡、AI 输入栏插件 toggle）现按 `scope_use` 随对话类型显隐，与工具 `scope_use` 同一套场景轴，**fail-closed**：未声明 / 空数组 = 任何会话都不显示。**行为破坏性变更**——既有不声明 `scope_use` 的活动面板标签卡 / 输入栏 toggle 将不再出现，需显式声明（如 `scope_use: ["project", "conversation"]`）。
- `PluginAgentToolRegistration.scope_use` 类型由 `string[]` 收紧为 `readonly ConversationScenario[]`，声明工具可见场景时获得补全与拼写校验。

### Added

- **`PluginInputActionContribution.hardIsolation`**：为 true 时，宿主在 toggle 关闭期间剥离该插件的 agent 贡献与 Activity Tab（对齐 knowledgeMode 硬隔离，ADR-0041）。
- **`agent.mcp.control` 权限**与 **`PluginAgentManifest.mcpServers`**（相对 `.mcp.json` 路径或内联 server map），供插件声明内聚 MCP（ADR-0040）。
- 新增 `ui.slot.turn-card` 槽位与 `PluginContext.ui.registerTurnCard(contribution)`：插件可在消息列表底部（最新一轮）渲染一张**不绑定 tool 调用**的卡片，由插件组件自身决定可见性（不适用时 `return null`，借 `useActiveConversation` / `useConversationMessages` / `conversation.on("turn-end")` 读实时状态）。配套 `PluginTurnCardContribution` 类型与 `ui.slot.turn-card` 权限；`scope_use` 做 fail-closed 的会话场景门控。首个消费者是内置 Git 插件的「本轮变更卡」（turn-end 后列出本轮相对 turn-start 基线的变更）。
- 新增插件 i18n 表面（ADR-0033）：`PluginContext.i18n`（`t(key, params?)` / `locale` / `onChange`）与响应式 React hook `useTranslation()`（返回 `{ t, locale }`，宿主切语言即重渲染），配套 `PluginI18nApi` / `PluginTranslation` / `PluginLocales` / `PluginLocaleCatalog` / `PluginTranslate` 类型与纯函数解析器 `resolvePluginText` / `resolveCatalogKey` / `interpolatePluginText`，以及内部 `__PluginI18nContext` 和 host bridge `useLocale()`。插件把译文放包内 `locales/<lang>.json`（扁平 key→译文），宿主加载后随 `InstalledPlugin` 下发；宿主渲染的插件串（`plugin.json` 的 name/description/settings/guidingWords 与 `ctx.ui.register*` 的 `label`）用 `%key%` 占位符标记（非 `%key%` 即字面量、向后兼容），插件自己组件内文字用 `t()`。fallback 链：当前 locale → 插件 `defaultLocale`（manifest 声明，缺省 zh）→ 裸 key。
- 新增命令执行能力 `PluginContext.command.run(file, args?, opts?)`（execFile 语义、不走 shell、buffered 返回 `{ stdout, stderr, exitCode }`），配套 `PluginCommandApi` / `PluginCommandRunOptions` / `PluginCommandRunResult` 类型，门控既有占位权限 `agent.command.run`。插件须在 `plugin.json` 顶层 `commands: string[]`（二进制名）声明可执行的命令，未声明一律拒；用户可在插件设置里逐条开关，被关命令调用时被拦截并通知用户。详见 `docs/adr/0032`。
- 新增 `ConversationScenario` 联合类型（`"im-claw" | "conversation" | "project" | "batch" | "automation" | "kb-processing" | "cli"`），并给 `PluginActivityTabContribution` 与 `PluginInputActionContribution` 新增 `scope_use?: readonly ConversationScenario[]`：插件可把会话页活动面板标签卡 / 输入栏 toggle 限定到特定对话类型（镜像 agent 工具的 `scope_use`）。输入栏 toggle 的 `scope_use` 与 `requiresActiveTool` 取「与」。
- Added `PluginContext.agent.registerContinuationProvider()` and the `agent.continuation.register` permission so plugins can request another turn when the agent reaches a natural stopping point.
- Added the initial trusted plugin SDK contract with plugin lifecycle, permissions, global UI slot types, and `definePlugin()`.
- Added plugin agent tool and file API contracts: `PluginContext.agent.registerTool()`, TypeBox/JSON-Schema-friendly tool registration types, `PluginContext.fs`, and the `agent.tools.register`, `agent.toolHandler.execute`, `fs.read`, and `fs.write` permissions.
- Added the file preview slot contract: `PluginUiApi.registerFilePreview`, `PluginFilePreviewContribution`, `PluginFilePreviewProps`, `PluginPreviewFile` (metadata + `readText`/`readBytes`/`getUrl` accessors), and the `ui.slot.file-preview` permission.
- Added the conversation API: `PluginContext.conversation` (`sendPrompt` / `insertText` / `abort` / `on`), `ConversationState` / `ConversationMessage` / `ConversationEvent` types, and the `useActiveConversation()` / `useConversationMessages()` hooks (backed by a host bridge injected via `__setPluginHostBridge`).
- Added the activity-tab slot contract: `PluginUiApi.registerActivityTab`, `PluginActivityTabContribution` (`id` / `label` / optional React-node `icon` / `component`), and the `ui.slot.activity-tab` permission. Registration only enters the addable pool — the tab renders after the user attaches it in the activity panel (attach records are keyed by session cwd).
- Added `useActivityTab()` and `ActivityTabContextValue`: a React-context hook exposing the cwd scope of the activity panel the tab is rendered in (provided by the host via the internal `__ActivityTabContext`). Use this instead of `useActiveConversation().cwd`, which can point at another project on the project detail page.
- Added the input-action slot: `PluginUiApi.registerInputAction`, `PluginInputActionContribution` (toggle with `label`/`icon`/`onToggle`/`decoratePrompt`), `PluginPromptDecoration`, and the `ui.slot.input-action` permission. While active, `decoratePrompt()` merges metadata into the next outgoing prompt (e.g. `{ imageMode: true }`).
- Added the message card system (ADR-0030): `PluginUiApi.registerCardRenderer`, `PluginCardRendererContribution` (keyed by globally-unique `type`, with default `title`/`icon` and an optional `pendingFor` that synthesizes an in-flight skeleton descriptor), `CardDescriptor` (`{ type, key?, payload, title?, icon? }`), `PluginCardProps` (`{ descriptor, pending, message }`), `PluginPendingToolCall`, and the `ui.slot.message` permission. Cards are declarative descriptors a tool emits on its result's out-of-band `details.cards` (or that `pendingFor` produces for a pending tool); the host resolves each by `type` to a renderer, dedups by `key` (a lineage shows only under its latest turn), and renders only the cards a message actually has — replacing the prior "mount every slot, each self-hides" message-slot model.
- Added `PluginUiApi.openActivityTab(tabId)`: programmatically attach + activate one of the plugin's own activity tabs in the current conversation's panel.
- Added `PluginOpenActivityTabOptions` and the optional second argument `openActivityTab(tabId, { width })`: a plugin (or its tool's card) can size the activity panel as it opens — a pixel number or `"max"` for the widest the current window allows. The host clamps to its min/max bounds and auto-hides the sidebar when the panel gets wide. Omit to keep the user's current width.
- Added `PluginImagesApi.sessionLineages(sessionId)` and the `useEditImageAttachment()` hook: list every edit lineage a session touched (newest first; each oldest→newest) for a "history" panel, and reactively read the current edit-attachment (single source of truth for the "selected for edit" highlight).
- Added `PluginUiApi.setEditImageAttachment(ref | null)`: bind (or clear) an image as the next prompt's edit target. The host renders it as a thumbnail capsule in the AI input bar's top strip and injects `metadata.editImageId` at send time (one-shot). Added `PluginImageRef.rootId` (edit-lineage root, used as a card descriptor `key` for per-message preview dedup). The in-flight edit source now rides a card descriptor's `payload` (via the renderer's `pendingFor`), so the skeleton card renders the source lineage with a leading placeholder.
- Added the images API: `PluginContext.images` (`generate` / `edit` / `lineage`), `PluginImagesApi`, `PluginImageRef`, `PluginGenerateImageInput` (with optional `size`), `PluginEditImageInput`, and the `images.generate` permission. Routed to the host's main-process image service; bytes are stored out-of-band and returned as media references.
- Added the settings API: `PluginContext.settings` (`get` / `getAll` / `onChange`) and `PluginSettingsApi`, reading values configured against a plugin's declared `contributes.settings` schema.
