# Changelog

All notable changes to `@vetta-org/plugin-sdk` are documented in this file.

## [Unreleased]

- 新增会话底部面板贡献点 `ctx.ui.registerBottomPanel()` 与配套权限 `ui.slot.bottom-panel`，要求 Plugin API `^2.7.0`。它与活动面板标签卡的分工是：活动面板在右侧、一个贡献一个实例，适合看某个东西的当前状态；底部面板横跨会话页下沿、可分屏、**同一个贡献可以开多个实例**，适合终端、日志跟随这类长驻工作面。实例的名字、图标、状态点与关闭前裁决都走命令式的 `useBottomPanel()`——多实例下「每帧返回 meta 的 hook」拿不到实例身份，会让改名在两份事实源之间打架。

- Activity Tab、新会话上下文、输入动作、消息卡片 renderer 与文件浏览器操作在未声明 `icon` 时统一继承 `plugin.json#icon`；各贡献仍可用自己的 `icon` 覆盖，显式 `null` 保持无图标。`CardDescriptor.icon` 现在也会按既有合同覆盖 renderer 默认图标。纯运行期默认行为调整，不涉及清单字段，`pluginApiVersion` 不变。

- Official plugin installation options accept the reserved `initiator` diagnostic marker used by `plugin-cli` and Plugin Workbench. Desktop records it in local ability lifecycle logs; third-party plugins should leave it unset.

- `PluginModelDefinition` exposes `reasoningLevels` and `defaultReasoningLevel`, so model providers can publish their native reasoning choices without losing them at the host's write boundary. Requires the corresponding Desktop capability schema fix.

- 新增 `@vetta-org/plugin-sdk/logger`。配套 `plugin-vite` 会从已校验的 `plugin.json` 为每个插件生成不可变的 `id@version` logger；插件无需持有或传递 `ctx`，日志仍由 Desktop 统一持久化、轮转并纳入诊断信息。使用该入口的插件要求 Plugin API `^2.5.0`。
- Media Provider v5 可在 `generate` capability 中声明 `models` / `defaultModelId`；生成请求的 `modelId` 现在由宿主校验。Provider handler 新增 `readInput()`，只读取当前调用输入，供 JSON 内联图片 API 使用。
- 官方图片设置增加 `textToImageModelId` / `imageToImageModelId`，旧的仅 Provider 配置继续使用该 Provider 的默认模型。
- 官方插件新增 `ctx.official.agent.getImageGeneration()` / `setImageGeneration()`，用于读取或更新宿主 Agent 的文生图、图生图 Provider 偏好；普通插件仍会被官方能力门控拒绝。
- `PluginImageRef.providerId` 可记录实际生成图片所使用的 Provider，便于历史记录展示来源和后续编辑追踪。
- `PluginServiceRequest.timeoutMs` 的宿主上限统一为 5 分钟，覆盖图片、视频等长时间运行的受管服务请求；默认值仍为 30 秒。

## [0.3.5] — 2026-09-16

### Added

- **`useSidebarState()` / `ctx.ui.getSidebarState()` / `ctx.ui.onSidebarStateChanged()`：插件
  可以感知宿主左侧侧边栏的形态**。此前 `ctx.ui` 只有注册与动作，没有任何 getter 或订阅，插件
  对宿主布局完全失明——连自己调 `setActivityPanelWidth("max")` 间接收起了侧边栏都读不到结果。

  最吃亏的是沉浸式工作区视图（`setWorkspaceViewHeader` 的 `immersive: true`）：侧边栏收起时
  宿主页头会长出「展开侧边栏」按钮压在左上角，视图画在那一带的东西没法让位。

  三个字段各有分工：`collapsed` 是用户意愿（窄屏下也不受窗口宽度影响），`narrow` 是窗口窄到
  侧边栏改走悬浮覆盖，`visible` 等价于 `!collapsed && !narrow`——多数自适应只需要最后这一位。

  订阅回调按值去重，拖窗口不会把监听器打成回调风暴。无需权限：纯布局信息，不含用户数据。
  纯视觉自适应可以完全不碰 JS——宿主把同一份状态挂在整帧根节点的
  `data-sidebar-collapsed` / `data-sidebar-narrow` / `data-sidebar-visible` 上。

  纯运行期 API，不涉及清单字段，`pluginApiVersion` 不变。

## [0.3.4] — 2026-09-14

### Added

- **`ctx.ui.previewFile(file, group?)`：插件可以打开宿主的全局文件预览**。此前只有
  `previewImage`，且只吃图片 URL——插件想把自己产出的本地文件（报告、导出的表格、生成的 svg）
  给用户看，只能自己再造一个预览面板。宿主的全局预览本来就认本地绝对路径（文件树走的就是这条），
  这一条只是把口开出来。

  预览器**按文件名的扩展名**分发渲染器，所以插件用 `registerFilePreview` 注册过的扩展名，
  由 `previewFile` 打开时也会落回它自己的渲染器。

  权限按形态定而不是按 API 名：任一条目带 `path` 需要 `fs.read`（等于把本地文件交给宿主去读），
  纯 `url` 形态沿用 `previewImage` 的 `ui.slot.message`。

  纯运行期 API，不涉及清单字段，`pluginApiVersion` 不变。

## [0.3.3] — 2026-09-14

### Added

- **团队成员可以带任务书（Plugin API 2.3.0）**：`teams[].members[].instructions` /
  `instructionsPath` 给单个成员一份追加在它本体人格之后的团队内交待。与 `responsibility`
  分工不同——后者是一句全队可见的职责摘要（进共享名册），前者是只给这名成员看的做事方式。

  这一条补全了跨插件引用：任务书挂在消费方的团队上，**不碰被引用那一方的人设**，所以你可以
  把别的插件的设计师拉进来并交待清楚本团队怎么干，而它在别处照旧。

  队长的任务书仍写在团队的 `workflow` 上；`members[0]` 再写 `instructions` 会在构建期被拒，
  两处都能写就没人说得清哪份生效。

  **用到这两个字段请把 `pluginApiVersion` 写成 `^2.3.0`**（未知字段 fail-closed，理由同 0.3.2）。

## [0.3.2] — 2026-09-14

### Added

- **团队成员支持角色槽位与跨插件引用（Plugin API 2.2.0）**：`agents[].roles` 让一个智能体对外声明
  它能顶的角色；`teams[].members[]` 改为 `agent` 与 `role` 二选一——`agent` 可写
  `<pluginId>/<agentId>` 直接引用别的插件，`role` 只声明需要什么角色、由宿主解析。
  新增 `optional` 控制解析不到时是否照常发布团队（跨插件引用与角色槽位缺省为 `true`，少一名
  队员而不是少一支团队）。
  装机自带的 `master`/`developer`/`researcher`/`auditor`/`business`（`preset-agent`）与
  `designer`（`vetta-ui-design`）已对外供货，词表见 `BUILTIN_PLUGIN_AGENT_ROLES`。

  队长仍限定为本插件自己的智能体：它是用户唯一的对话入口，落在别的插件上会让这支团队随那个
  插件一起变成打不开的壳。

  **用到这些字段的插件请把 `pluginApiVersion` 写成 `^2.2.0`**。清单校验对未知字段 fail-closed，
  旧宿主会整个拒掉这份清单；声明版本后拿到的是「版本不支持」这种指向明确的错误。

## [0.3.1] — 2026-09-14

### Added

- 手册（`docs/plugin`）随包发布，落在安装后的 `node_modules/@vetta-org/plugin-sdk/docs/`。
  仓库外的 Agent 因此能读到与本工程实际编译版本一致的合同，不必依赖 Vetta 源码仓库或插件工作台；
  路径用 `npx vetta-plugin-cli docs` 解析，不要硬编码。

## [0.3.0] — 2026-09-14

### Breaking Changes

- **插件私有存储改为文件与 revision 合同（ADR-0107，Plugin API 2.0）**：移除 `readJson/writeJson`；
  `readFile/writeFile` 显式接收 `utf8 | base64`，新增 `commit/readSnapshot` 支持多文件原子发布、
  一致读取和 `expectedRevision` 乐观并发控制。SDK 另提供基于文件原语的 `readJsonFile/writeJsonFile` 便利函数。

- `ctx.models` 的自有 Provider 管理改为 `replaceOwnedProviders()` 原子快照；移除插件侧逐个 `upsertProvider/removeProvider`。
- `ctx.services` 新增 `reportReady()`，并支持 `health.readiness.mode = "plugin"`，服务只有在插件完成业务数据初始化后才进入 `ready`。

- **插件配置改由插件自绘（ADR-0105，Plugin API 1.6.0）**：移除 `plugin.json#contributes.settings`、只读的
  `ctx.settings`、`registerTool({ configuration.settingKeys })`、handler 上下文里的 `plugin.settings` 快照，以及
  `ctx.ui.openPluginSettings()`。宿主不再提供设置页配置槽，插件用 `registerWorkspaceView` 自绘配置界面。
  普通配置存 `ctx.storage`（宿主升级时把旧值一次性迁到 `settings.json`），密钥改用下面的 `ctx.secrets`。
  带 `contributes` 的旧清单不会校验失败，但字段不再有运行时语义。

### Added

- 插件清单新增 `agent.agents` / `agent.teams`：插件可以贡献**完整的智能体与团队**（人设、头像、系统提示词、
  `mentionHandle`、能力继承范围），宿主在插件启用时把它们铺成普通档案，禁用时灰着留在原地、重新启用即恢复。
  人设是静态数据，因此走清单而不是运行时 API——装机目录回填要在插件前端跑起来之前就知道有哪些角色。
  团队成员只能引用本插件自己的智能体（跨插件引用会让一个插件能否使用取决于另一个插件装没装）；
  `legacyIds` 用于接管历史 blueprint / 团队 id，把人设迁进插件时认领用户已有档案而不是铺重复的一份。
  头像与提示词路径同时登记进 `listPluginManifestResources` 并做越界校验，打包器据此把它们收进归档。

- 新增 `ctx.ui.registerNewSessionContext()` 与 `ui.slot.new-session-context` / `conversation.draft.read` 权限：
  在新会话页输入框下方铺一块内容，摆出用户接下来多半要用到的素材。上屏由宿主按声明式的 `activateWhen`
  裁决而不是给插件推送——推送意味着每个注册了本槽位的插件都能拿到用户逐键输入的全程内容。激活条件只能引用
  本插件自己的智能体 / skill / MCP，且至少要声明一条。`width: "wide"` 供画廊类内容铺满页面可用宽度；
  上下文只提供回写输入栏的 `composer.attach` / `insertText`，没有「直接发送」。草稿另受
  `conversation.draft.read` 门控，且只在该贡献处于激活状态时提供。

- 插件清单新增 `agent.skillPresentation`：插件可按产品入口控制 Skill 可见性，并为公开 Skill 声明本地化展示名与说明；展示策略不改变运行时加载、权限或稳定 Skill 名（ADR-0110）。

- 工具调用槽位的 `status` 新增 `cancelled`，用于区分用户中止与工具执行失败。

- 新增 `ctx.ai.stream()`：沿用 `ai.complete` 权限与单轮请求/最终结果合同，通过 `onTextDelta` 提供经过校验的
  文本增量，并支持使用 `AbortSignal` 取消主进程中的 Provider 请求。

- 插件 MCP 新增 `type: "service"`，可通过 `serviceId + path` 绑定本插件声明的受管本地服务；
  `ctx.services` 新增受目录约束的 `readDataFile/writeDataFile`，供插件在服务停止后管理自己服务的数据文件。

- 新增 `ctx.ocr` 与 OCR Provider SPI：消费者提交批量图片引用，Provider 通过受控输入 URL/上传接口适配本地或远程识别服务；宿主统一权限、取消、进度、能力协商和结果校验（ADR-0108）。

- `registerWorkspaceView` 新增 `sidebar?: boolean`（缺省 `true`，既有插件行为不变）：置 `false` 的视图不占侧边栏导航位，
  只在「设置 → 更多选项」里列出，并由宿主在设置壳内打开——两层侧栏保持可见，用户在多个插件页面之间切换是一次点击。
  适合配置页、安装引导、诊断台这类不常驻的 surface。

- 新增 `ctx.secrets` 与 `secrets.read` / `secrets.write` 权限：插件读写**自己的**密钥，值存宿主加密凭据库而不是
  明文存储；归属由 capability session 决定，拿不到其它插件的密钥。`keys()` 只返回键名。

- 新增声明式 `plugin.json#providers.services` 与 `ctx.services`：插件通过 `ctx.network` 自行下载并校验固定制品，
  再交给 Desktop 二次校验、安全解包、启动、健康检查并限制在自身回环 origin；新增 `models.manage` 与 `ctx.models`，
  获授权插件只能维护以自身 plugin id 命名的模型 Provider。宿主不包含任何上游服务专用路由或 Provider 语义
  （ADR-0104）。

## [0.2.0] — 2026-09-01

### Breaking Changes

- 删除 `registerTool.side_effect`，插件工具不再声明 light/heavy，也不再触发宿主首调确认或缺省声明警告。preset 与 external 插件同步删除字段，不提供旧类型兼容。
- 删除插件清单的 `runtime` 选择字段，`moduleFederation` 改为必填；插件只支持 Module Federation，不提供其它加载路径兼容层（ADR-0091）。
- **`agent_mode` 声明整体废弃（ADR-0071，行为变化）**：`plugin.json#agent_mode`、`registerTool({ agent_mode })`、`registerHook({ agent_mode })`、MCP 内联 map 的 `agent_mode` 与 `SKILL.md` frontmatter 的 `agent_mode` 不再有任何运行时语义——上一版它们还影响清单排序，本版确认排序对模型工具选择无可观察影响后归零。字段全部容忍传入（既有插件不需要改 manifest、不会校验失败），宿主直接忽略。要引导模型少用某个工具，把使用条件写进该工具 description 的反向触发段（Do NOT / Only for）。`AgentMode` 类型放宽为 `string`：合法模式 id 由宿主的模式注册表定义（未来可扩展），插件不应硬编码 `"work" | "coding"` 枚举，未知 id 一律按通用处理；`ctx.getAgentMode()` / `onAgentModeChanged()` 语义不变（仍是「新会话默认模式」，只适合展示层定制）。
- `network.fetch` 现在必须同时声明 `plugin.json` 的 `network.allowedHosts`；宿主按域名/IP校验首跳与重定向。私网 IP、localhost 与显式 `*` 对所有来源使用相同规则。
- Replaced the media protocol v2 task surface with generic operation, job, and artifact APIs: consumers now call `ctx.media.submit()` with a typed `generate | compose | transcode` request, control host-owned work through `ctx.jobs`, and persist or release temporary output through `ctx.artifacts`. Provider registration now uses `submit()`, operation-specific capability declarations, opaque `inputs`, and `uploadInput()`. The old `createJob/getJob/cancelJob/saveArtifact/releaseArtifact` methods were removed without a compatibility layer (ADR-0059).

### Added

- 新增声明式 `plugin.json#providers.cli`、`ctx.cliProviders` 与 `registerAbilityDetailSlot`：插件可以让宿主在启用后
  探测/安装 CLI 依赖、订阅真实进度，并在目标能力详情页承接上游原生配置流程；Agent 贡献会等到 Provider 就绪后发布。
- `ctx.browser` 现在始终提供统一 facade；`ctx.browser.open()` 可在 Desktop 内置 Browser Panel 中打开受 `browser.allowedHosts` 约束的 HTTP(S) 页面，具体方法仍按权限单独校验。该展示型 API 不授予页面读取或自动化权限。
- `PluginAppActionRegistration.usage` 与 `PluginAppActionUsage`：可声明 `target`、`useWhen`、`avoidWhen`、`alternatives`，经宿主结构校验后随 search / describe 返回；仅指导模型选择，不改变权限与审批。
- 新增宿主管理的 `ctx.browser` facade 与 `browser.read` / `browser.interact` / `browser.profile.persist` / `browser.attach` / `browser.runtime.manage` 权限。插件通过结构化 session、profile、导航、快照、读取、截图和动作 API 复用登录态浏览器；manifest 必须声明最大 `browser.allowedHosts`，每个 session 只能进一步收窄。公共合同不暴露路径、Cookie、token、任意 argv 或 JavaScript（ADR-0088）。
- `ctx.agent.registerTool()` 新增可选 `configuration.settingKeys`：动态 Tool 可把自己与插件
  `contributes.settings` 的全部或部分字段关联到宿主统一配置目录。未声明配置的 Tool 行为不变；宿主会拒绝未知或重复
  setting key，并以 Adapter 而非原生 Tool 配置的方式呈现。
- `registerWorkspaceView` 新增 `iconTint?: boolean`（缺省 `true`）：置 `false` 时侧边栏入口保留插件 Logo 的原始色彩（`svg` / `png` / `webp` 等），而不是按主题前景色染成单色。仅对图片图标生效，Iconify class 图标始终跟随主题色。入口只有 16px 且固定色彩无法跟随明暗主题，选用前请参考 ui-slots.md 的取舍说明。
- `registerWorkspaceView` 省略 `icon` 时，侧边栏入口改用插件自己的 `plugin.json` 图标（包内图片按主题前景色 mask 渲染），与活动 Tab 的回落行为一致；两者都没有才落到宿主默认图标。已显式声明 `icon` 的插件行为不变。
- `ctx.ai.chat()`：无状态多轮文本完成。插件自行持有并持久化 `messages` 全量转写（user / assistant / toolResult），可携带仅本次请求可见的插件内部工具（`tools` + JSON Schema）；模型触发工具调用时返回 `stopReason: "toolUse"` 与 `toolCalls`，由插件执行后以 `toolResult` 消息续写。权限沿用 `ai.complete`，宿主不保存任何会话状态。
- Activity Tab 命令新增可选 `cwd` 目标：tool handler 与后台任务可把 `openActivityTab` / `setActivityTabVisible` 绑定到触发会话，不再依赖调用完成时恰好处于前台的会话。
- 媒体生成能力新增可选 `defaultResolution`，分辨率字符串明确作为 Provider 自定义的稳定选项 ID；消费者在已有值不受支持时可使用显式默认档，而不必把数组顺序当作默认策略。
- `PluginWorkspaceViewHeader.immersive`：页头浮在工作区视图之上（视图占满全高、顶端滑入透明页头条下），用于门面从窗口第一像素开始的沉浸式整页。
- `ui.setWorkspaceViewHeader(viewId, header | null)`：工作区视图可以把标题与工具栏搬进宿主页头（`hideTitle` / `title` / `left` / `right`），不必在内容区里再画一条顶栏。实时 setter，权限沿用 `ui.slot.workspace-view`，只在该视图自己的路由上生效，视图注销或插件卸载时宿主自动撤下。
- 新增 `tool-call-args` 会话事件（`ConversationEvent`）：模型还在生成这次工具调用，流式参数已解析出的部分键。用于「agent 正在动某个目标」这类实时 UI——`edit` / `write` 等到 `tool-call-start` 时活已经干完了。参数天然残缺，权威全量值仍取 `tool-call-start`。权限沿用 `agent.session.read`。


- **`official.dialog.openFiles(options)`**：打开原生文件选择框并把选中文件的**内容**（base64）一起返回。插件的 `ctx.fs` 只能读已授权的项目根，所以「选个文件再自己去读」这条路走不通；这个接口不放宽任何目录授权，插件能看到的只有用户这次亲手选中的文件。用户取消时返回空数组，单文件默认 64MB 上限。
- **`official.shell.showItemInFolder(path)`**：在系统文件管理器里定位一个本地路径。与 `ui.openExternal` 分工明确——后者只放行 http/https，刻意不让插件用它拉起任意协议（含 `file://`）。
- **`official.sessions.listRunningCwds()`**：当前有会话在跑的项目 cwd（去重）。需要「这个项目忙不忙」时用它，**不要**拿 `listRunning()` 的路径去比对 cwd：会话文件默认落在按 cwd 编码的分片目录里，那个编码把 `/`、`\`、`:` 全压成 `-` 且不可逆，`my-project` 与 `my/project` 会撞进同一个分片。
- **`official.navigation.open({ target: "new-session", cwd, draft })`**：`draft` 可选，把一段文本预置到该项目新建会话页的输入框（不发送，用户可继续编辑）。文本用输入框自己的行内 token 形态书写（`@skill:名字` / `@mcp:名字` / `@/abs/path`），宿主会渲染成对应的 badge。草稿写在**跳转之前**，因此不会被新会话页的草稿恢复覆盖——「先跳转、再往输入框塞内容」这条路必然被那次恢复冲掉。该 cwd 上已有的未发送草稿会被替换。
- **`official.navigation.open({ target: "new-session", cwd })`**：跳到某个项目的新建会话页。这是第一个**带参数**的导航目标，`PluginOfficialNavigationOpenInput` 因此新增可选 `cwd`；缺 cwd 或传相对路径会被宿主拒绝，而不是跳到一个空页面。目录（`navigation.help()`）里同步列出该目标。
- Added the versioned `@vetta-org/plugin-sdk/npm-package` contract for validating npm plugin distribution envelopes and package-contained archive paths; official plugin install summaries now expose active/pending versions and accept host-verified npm identity metadata.
- `ctx.plugin.iconUrl`：宿主从 `plugin.json#icon` 解析后注入的不透明品牌图标；Activity Tab 省略 `icon` 时宿主自动用它填栏。插件不要自行 `import` 包内 png 或拼宿主协议。
- `definePlugin().activate()` 现在可返回函数或 `Disposable`，宿主会把它绑定到本次 activation，并在对应实例被替换、停用或后续加载失败时清理；热更新中的有状态资源不再依赖无法区分新旧实例的模块级 `deactivate()`。
- **工作区视图 `ctx.ui.registerWorkspaceView()`**（新权限 `ui.slot.workspace-view`）：插件可以贡献一个**整页 surface**，与内置的「自动化」「知识库」同级——宿主给它一条自己的路由 `/workspace/<pluginId>/<viewId>` 和一个侧边栏导航入口，打开后整个内容区归插件。用于跨会话、跨项目的工作台（看板、控制台、仪表盘）；绑定单次对话的辅助 UI 仍应使用 Activity Tab。配套 `ctx.ui.openWorkspaceView(viewId)` 做程序化跳转。视图 `id` 会进 URL 并参与侧边栏布局持久化，故限定为 `^[a-z0-9][a-z0-9._-]*$`；`icon` 是 **iconify class 字符串**而非 ReactNode（宿主要把它渲染进自己的导航按钮并按 key 持久化布局）。导航入口默认落在侧边栏「更多」收纳里，用户可拖拽排序或 pin 到左上方置顶区。见 ADR-0065。
- **`official.sessions`**（仅 official 来源插件可用）：后台会话编排 —— `create` / `prompt` / `abort` / `rename` / `list` / `listRunning` / `onRunningChanged` / `open`。与 `ctx.conversation.*` 的分工是：后者作用于**用户当前正在看的**会话，这套 API 按 sessionId 显式寻址、与当前路由无关。会话本体跑在主进程，创建并 prompt 之后即使宿主停在别的页面、插件 UI 未挂载，agent loop 也会继续跑到自然停止点——这是「多任务并发派单」类工作台成立的前提。见 ADR-0065。
- **宿主成品 UI 组件对插件开放**：新增共享入口 `@vetta-org/theme-ui/plugin-ui`（Module Federation 共享域，与 `@vetta-org/ui` 同一机制），插件拿到的是宿主运行时的**同一份实例**，因此不是「长得像」而是同一个组件。首批开放 `ModelSelectorView`（搜索、provider 分组与图标、云端/默认/视觉徽章、推理档位子菜单）、`ProviderIcon`、`MultiplierTag`。全部为纯展示组件：数据、文案、写回逻辑经 props 注入，插件可在自己的语义下复用（看板给「某张卡」选模型，宿主输入栏给「当前会话」选模型）。清单有意收窄，见 `packages/theme-ui/src/plugin-ui`。
- `official.models.list()` 的 provider 摘要新增 `icon`（图标 symbol），配合 `ProviderIcon` 即可渲染出与宿主一致的服务商图标。
- `official.models.list()` 现在返回**用户实际可选的全部模型**：除本地配置的 provider 外，还包含登录后服务端下发的远程目录（Vetta Go 等，摘要上带 `remote: true`），与宿主输入栏模型选择器同一口径；同一个 `provider/modelId` 以本地为准。`assertModelKeyExists` 同步认这些远程 key（此前会误判为不存在，因为主进程只看得到本地模型配置）。
- `official.sessions` 支持指定模型：`create({ cwd, title, modelKey })` 把模型写进新会话的**会话设置**（后续插件 prompt 与用户在对话页手动接管都用它）；`prompt(sessionId, text, { modelKey })` 只钉住这一轮、不改会话设置。两者都可省略，省略即跟随宿主全局默认模型。可选模型清单来自既有的 `official.models.list()`。
- `capture.offscreen` 新增 `probeScript` 与结果字段 `probe`：插件可在**截图的同一时刻**对离屏页面求值，把渲染后的 DOM 度量（换行、裁切、空图标位、边缘错位等）与位图一起取回，无需为了量一次布局再渲染一遍。结果经 JSON 往返；求值抛错或不可序列化时 `probe` 为 `undefined`，位图照常返回——探针是搭车的附加信息，不会成为截图失败的原因。
- **工作区视图导航项角标**：`PluginWorkspaceViewContribution.badge` 声明初始角标，`ctx.ui.setWorkspaceViewBadge(viewId, badge | null)` 运行时更新（权限同为 `ui.slot.workspace-view`）。`PluginNavBadge` 是判别联合：`beta`（宿主预置，渲染与内置「知识库」完全一致、文案由宿主按当前语言给出，插件不必自己翻译）、`text`（支持 `%catalogKey%`）、`count`（超 99 显示 `99+`，归零即消失）、`dot`；各带可选 `tone`（`default` / `accent` / `warning` / `danger`，宿主映射到自己的主题色，插件给不了原始色值）。运行时更新必须走 `setWorkspaceViewBadge` 而不是重新注册——后者会让整页 surface 重挂载。认不出的角标当作「没有角标」，不会让注册失败。
- `conversation.createSession(cwd, { navigate })`（权限同 `sendPrompt`，即 `agent.session.write`）：在指定 workspace 建一个会话并设为活动会话，resolve 时已可直接 `sendPrompt`。用于宿主此刻**没有活动会话**的场景——用户停在新会话页时 `sendPrompt` 无处可发，此前插件只能干等；现在可以自己起一个。默认跳转到对话页，后台任务可传 `navigate: false`。执行模式跟随宿主当前选择。不做复用判断：已有活动会话时照样新建。与 `official.sessions.create` 的分工是后者按 sessionId 显式寻址、与当前路由无关。
- `conversation.sendPrompt` 返回 `SendPromptResult` 回执（ADR-0060）：空闲时整轮结束后 resolve `{ status: "sent" }`；agent streaming 中 prompt 进入会话队列并立即 resolve `{ status: "queued", queueItemId }`，队列在本轮自然停止点接力消费、被打断/出错后暂停待用户处置。`conversation.on` 新增 `queue-changed` 事件（携 `{ paused, items }`），插件可据此呈现排队条目的真实状态。原 `Promise<void>` 消费方无需改动。
- 媒体 Provider 生成能力新增 `modeCapabilities` 与输入 `role`：Provider 可按模式声明首帧、尾帧、图片/视频/音频参考的类型和数量，以及比例、音频策略；媒体协议升级到 v4。
- `ctx.agent.registerHook()`：ESM / Module Federation 插件可动态注册 Coding Agent 的 12 类原生 Hook 事件，并以 `Disposable` 注销。事件与返回值是判别联合；`PreToolUse`、`PermissionRequest`、`Stop` / `SubagentStop` 提供事件专属结果。新增 `agent.hooks.register` 与 `agent.hookHandler.execute` 双权限；`scope_use` 必填且 fail-closed，支持 `agent_mode` / `toolNames` 过滤、超时与 Main 边界校验（ADR-0064）。
- `PluginActivityTabContribution.keepAliveWhenAvailable`：插件可让有状态 Activity Tab 在切换后继续挂载；`useActivityTab()` 新增 `active`，插件可在标签卡激活时调用既有的 `setActivityPanelWidth()` 等命令式能力。
- `PluginStorageApi.putBlobFromFile()`：插件可把用户选择或拖入的真实文件直接交给宿主复制到私有 Blob；preload 负责从 `File` 提取路径，文件字节不进入插件 renderer、不进行 Base64 编码，仍受 `storage.write` 权限约束。
- `PluginPromptAttachment.context` 结构化、版本化 JSON 上下文与 `lifecycle: "sticky"`：插件可把用户当前选择等应用状态作为可校验对象附到输入栏，宿主发送时冻结快照；`definePluginPromptContext()` 提供 JSON 安全与大小校验，旧的 metadata/instructions 一次性附件保持兼容。
- `ctx.ai` 宿主管理的文本推理能力：插件通过 `ai.models.list` 获取可用文本模型，通过 `ai.complete` 调用用户已配置的模型。模型解析、凭据注入与请求执行均留在 Desktop 主进程，插件不会接触 API Key；首版契约提供单轮 `systemPrompt + prompt` 完成、推理级别、温度、最大输出和 token 用量。
- `ctx.media` 宿主媒体协议 v3：支持类型化的生成、工程合成和转码操作；Provider 可从远程 URL、插件 Blob 或工作区文件交付输出，由宿主统一导入为 owner 隔离的临时产物。`onProvidersChanged()` 允许并行激活的消费插件响应 Provider 增删。Desktop 内置的 Vetta 图片 Provider 仍固定在主进程调用网关，插件拿不到 JWT，也不能传任意网关路径（ADR-0059）。
- `ctx.gateway`（`PluginGatewayApi`）：带当前登录身份调用 Vetta 服务端（ADR-0056）。插件只给出**相对 `/api/v1` 的路径**与 JSON body，服务端地址、`Authorization` 与 401 刷新重试全在宿主主进程完成——插件拿不到 token，也拼不出指向其它接口的绝对 URL；把 JWT 交给插件进程等于开放整个 `/api/v1` 的越权面，因此 SDK 不提供「取 token 自己拼」的口子。业务信封由宿主拆开，返回 `{ ok, status, code, message, data }`，配额用尽/档位无权限这类**不抛异常**（它们是常规业务分支，插件应据此渲染引导）。**该字段可选**：只对随包分发的 official 插件挂载，第三方插件读到 `undefined`，使用前必须判空。这样收口的理由不是防越权（服务端档位授权已限定可用模型、消耗的是用户自己的额度），而是防插件偷跑烧光用户配额——在缺少插件签名与审核机制前，「安装时用户确认」形同虚设。

- `PluginUiApi.openExternal(url)`：把链接交给系统默认浏览器（Electron `shell.openExternal`），不是 App 内置的浏览器面板。只接受 `http:`/`https:`，其余协议宿主直接拒绝。需新权限 `shell.openExternal`。
- `ctx.capture.offscreen(options)`（`PluginCaptureApi`，新权限 `capture.offscreen`）：宿主主进程用隐藏离屏窗口加载 http(s) 页面并 `capturePage` 出图。与 DOM 克隆类截图（html-to-image）不同，走真实渲染管线，位图与页面在屏显示逐像素一致；`sessionKey` 复用窗口（url 未变跳过重新加载，SPA 切路由零加载），`prepareScript` / `readyExpression` 对接页面自己的就绪信号，`releaseOffscreen(sessionKey)` 主动释放。窗口闲置自动回收，插件禁用/卸载/重载与 App 退出统一清扫。**该字段可选**：旧宿主上 `ctx.capture` 为 `undefined`，使用前判空。
- Added the public `@vetta-org/plugin-sdk/tailwind-theme.css` host-theme contract for semantic Tailwind colors without importing Desktop component styles.

### Changed

- **`agent_mode` 由硬闸降级为纯偏好声明（行为变化）**：`plugin.json#agent_mode`、`registerTool({ agent_mode })` 与 `registerHook({ agent_mode })` 不再排除任何贡献。插件在任何工作模式下都会加载，声明的 Hook 在任何模式下都会按 `scope_use` 与工具 matcher 触发；宿主只把该字段当作排序与提示词详略的偏好。需要按模式定制行为的插件请在 handler 内用 `ctx.getAgentMode()` 自行判断。
- Activity Tab 现在默认采用有界 warm 驻留：访问过的组件在切换后保留，宿主按 LRU 最多缓存 2 个非活动 tab 并在空闲阶段淘汰。新增 `PluginActivityTabContribution.retention`（`active-only | warm | pinned`）；旧 `keepAliveWhenAvailable` 保持兼容并标记弃用（`true`=`pinned`，`false`=`active-only`）。
- `setActivityPanelWidth("max")` 与 `openActivityTab(id, { width: "max" })` 的 `"max"` 从「按当前窗口算一次宽度」改为**持续状态**：窗口尺寸变化时宿主重新求值，面板跟着一起变宽变窄，直到用户拖动分隔条或有人写入具体像素为止。传数字的行为不变（仍是一次性的固定宽度）。插件无需改动。
- **`official.sessions.list()` 的条目新增 `access`**（`PluginOfficialSessionAccess`：`readHistory` / `interactiveResume` / `rename` / `delete`）。宿主自己点会话时就是按这几位分流的（可续聊 / 只读查看 / 完全打不开），此前插件层把它丢掉了，插件只能盲跳。缺字段一律读作 `false`（= 完全不可用）：宁可退回新建会话页，也不要把用户送进一个打不开的会话。

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
