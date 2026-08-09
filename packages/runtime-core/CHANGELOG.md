# Changelog

All notable changes to `@vetta/runtime-core` are documented in this file.

## [Unreleased]

### Breaking Changes

- **Runtime Host 生产 API 移除 Greenfield 迁移命名**：Kernel 驱动的会话、模型、投影、上下文与组合工厂统一改用稳定的 `Runtime*` / `KernelRuntime*` 名称，并重命名对应生产模块；不保留旧类型别名。运行时协议值、会话持久化格式和宿主行为不变。

### Added

- **一次性初始化回滚事务**：新增 `InitializationRollbackScope`，按资源实际获取顺序登记、严格逆序全量回滚，并支持所有权转移时撤销旧任务；无清理错误时原样抛出初始化失败，清理也失败时以初始化错误为 `cause` 聚合诊断。Greenfield Runtime Factory 在外围初始化失败时会先关闭已创建的 Kernel Session，再释放 Composition 资源。
- **可重试 Runtime 关闭事务**：新增 `RetryableCleanup`，按 phase 全量尝试资源释放、共享并发关闭并只保留失败任务供后续重试；Greenfield Runtime Session 在首次清理失败后保持关闭准入，同时继续释放其余资源且不重复已成功的 Kernel/assembly 清理。
- **无损调用上下文与最终模型消息合同**：Runtime Message Envelope 新增产品无关的 opaque identity，并加入 Conversation Context Projector 与 Model Call Message Finalizer；Turn Pipeline 在压缩后按身份重建调用上下文，Agent Core 在调用级变换时保留产品消息身份、仅向 Provider 投影标准消息，使 Extension 等产品能力可在 Runtime Core 外无损适配且不改变持久化格式。
- **Runtime 消息身份执行观察**：新增产品无关的 `RuntimeMessageEnvelope` 与 `agent.end` / `message.*` 执行事件；Turn Pipeline 按显式 Run 顺序保留标准消息和通用 Context Record 身份，Agent Core 在 canonical 持久化前发布完整消息生命周期，不改变模型上下文或公开 Session Event。
- **Agent Run Preparation 合同**：新增显式输入专属的一次性 `AgentRunPreparer`，可在 Context Preparation 后持久化通用上下文并覆盖本次 Run 的 Prompt；系统提示词按需惰性解析，已编译的首次 Model Call Frame 由 Agent Core 复用，后续工具循环仍动态组合工具。
- **独立 Runtime 执行观察合同**：新增不依赖产品 Extension 或公开 `SessionEvent` 的 agent/turn/tool 完整执行事件，并由 Greenfield Session 提供有序异步观察流；观察者异常按订阅者隔离，不中断 Turn，也不把瞬时执行细节写入 Conversation Document。
- **Greenfield Extension 宿主所需只读 Session Port 与输入拦截点**：Core Assembly 新增 Conversation Document、待处理队列和上下文占用只读视图；Prompt Adapter 可在 Kernel 创建输入前返回变换后的请求或 `handled`，后者不会伪造消息或启动 Turn。合同不引用 Coding Agent Extension、SessionManager 或具体存储实现。
- **Greenfield Extension 会话动作端口**：新增 Session 级 Context Delivery、Metadata 与动态 Tool Controller；Kernel 原生区分活动 Turn 的 `steer` / `followUp`、下一次显式输入的 `nextTurn`、空闲仅持久化的 `record` 和立即续轮的 `triggerTurn`，并以无 `turnId` 的 `context.recorded` 保存 Turn 外上下文。Conversation Document 同时支持 Entry Label 元数据写入。
- **压缩后 Conversation continuation finalization**：`ContextStrategy` 新增通用的续接成功/失败回调；Turn Pipeline 在跨 Conversation 事务和 Session identity 重绑定后才执行成功 finalization，并以其结果决定 overflow retry，失败通知不替换原始 Store 错误。合同不包含 Memory、Hook 或 Extension 产品概念。
- **跨 Conversation Turn 续接协议**：新增独立 `ConversationContinuationStore`、`turn.transferred` / `turn.continued` 持久事实和瞬时 `conversation.continued` 重绑定事件；Turn Pipeline 可在压缩提交后保持同一 Turn 切换会话实体，AgentSession、工具调用、同步投影与宿主路径随之更新，恢复时不伪造新 Turn。
- **Greenfield Session 手动压缩与统一提交边界**：新增 `RuntimeSessionContextController`、`ManualContextCompactionRuntime` 和共享 `ContextCompactionCommitter`；Turn-start、模型调用检查点和手动压缩统一按 Repository 乐观版本提交，手动记录不伪造 Turn ID，并支持忙碌态、显式取消和自动压缩开关。
- **模型调用级 Context Checkpoint 与压缩提交**：Agent Core Turn Engine 将模型调用/assistant 结果/错误检查点桥接给 Turn Pipeline；Pipeline 在放行模型前按 Repository 顺序提交先前消息和可选 `context.compacted`，并支持 PostCompact 后的一次 overflow 恢复。检查点是进程内请求—应答事件，不进入持久会话日志。
- **Greenfield Context Strategy 与持久压缩合同**：新增可重建模型上下文的原生 compaction record、每次模型调用前的 transient Context Transformer、Profile 级 Observer 和压缩提交回调；Conversation Document 将最新摘要投影为“摘要 + 保留尾部”，同时保持完整聊天历史，Turn 输入继续与 `turn.started` 原子持久化。
- **Session-local 运行期 Context 追加边界**：新增 append-only Context Port 与 Pipeline-owned Buffer；产品 Hook 等运行期贡献只能提交通用 context record，由 Turn Pipeline 在持久消息之后及终态之前串行写入同一 Repository revision，避免产品适配器直接写会话存储或与消息事件竞争。
- **Greenfield Conversation Document Participant**：新增产品状态参与者与通用 `custom.append` 命令，Session 在初始化、分支写命令和安全的持久化事件边界同步参与者；Greenfield Core Assembly 交付真实 Todo Controller，但 Runtime Core 不解释 Todo 快照结构。
- **动态能力组合与通用 Turn Context**：新增 Session 级 `RuntimeCapabilityComposition`，以 newest-wins 编译和引用计数 lease 原子替换结构性能力；`SessionInput` 支持可持久化、可区分模型/UI 可见性的通用 context record，Conversation Document 分别投影模型历史和聊天历史，调用级贡献可读取当前 Turn input。
- **Greenfield 通用 Runtime Factory 与精确模型凭证绑定**：新增可注入 Repository、Snapshot、Model Runtime 和会话投影资源的组合工厂，统一创建/恢复 AgentSession、TurnPipeline 与 Turn Engine；模型凭证按 Turn 冻结的精确模型解析，prompt 切模与 reasoning 在当前 Turn 绑定前生效。
- **Greenfield Model Runtime 与 Turn 模型绑定**：新增抽象 Model Catalog/Credential Resolver、Session 级模型事实源和不可变 Turn Model Binding；Greenfield 的 Model Controller、Model View、State Reader 与实际 Turn 执行共享状态，运行时切模只影响后续 Turn且不重建 Capability Snapshot。
- **Conversation Document 写模型与 Greenfield History Controller**：新增独立 journal/document revision、Runtime-owned 历史命令与 Store Port；Greenfield 支持编辑导航、分支选择、删除、替换、fork 和运行中命名，活动分支会成为下一次 Turn 的真实模型上下文，默认 Legacy 生产入口保持不变。
- **Conversation Document 与 Greenfield History Read**：新增独立 `@vetta/runtime-core/conversation` 会话树读模型、Kernel Event 增量投影和宿主历史纯投影；Greenfield Core Assembly 交付真实 `historyReader`，保留旧分支、marker 和 timing 读取语义，不提供历史写操作空实现。
- **Greenfield Session Projection**：Greenfield Backend 在 create/resume 后从 Repository 初始化同步消息投影，并在持久化消息事件发布后增量更新；新增真实 Lifecycle、Workspace、Turn Control、Event Stream 和 State Reader Core Assembly、动态状态源与可执行能力矩阵，不为缺失的历史写操作、模型、Todo 或后台工作提供空实现。
- **Session Creation and Storage Boundary**：新增不暴露 SessionManager/customTools/ModelRegistry 的 `RuntimeSessionCreateRequest`，以及独立 `RuntimeSessionCatalog`、`RuntimeSessionFileHistoryReader`、`RuntimeSharedModelController` 进程级合同和 Legacy Adapter；RuntimeHost 不再直接创建旧持久化对象、沙箱工具或操作静态 SessionManager/文件历史，同时保留 create-only Backend、JSONL 列表/重命名/删除、共享模型刷新和 sessionId 延迟绑定行为。
- **Runtime Session Configuration Port**：新增统一的 `RuntimeSessionConfigurationController` 与旧 Session 适配器，由 Backend Assembly 显式交付 steering/follow-up 输入模式、插件运行时配置和 agent mode 命令；RuntimeHost 不再直接调用旧 AgentSession，并保留 turn 边界延迟应用、busy 跳过、插件失败恢复 pending 后重试及 settings 非空更新语义。
- **Runtime Session Work Management Port**：新增 `RuntimeSessionBackgroundWorkController`、`RuntimeSessionTodoController` 及保留完整 usage 的 runtime-owned subagent snapshot，由 Backend Assembly 显式交付；RuntimeHost 的后台 bash/subagent 列举、终止、联合清理和 todo 回放/受锁清空不再直接依赖旧 AgentSession/TodoStore，原返回值、复制和用户终止语义保持不变。
- **Runtime Session Execution / Workspace Port**：新增 `RuntimeSessionWorkspaceView` 与不暴露旧 custom tools 类型的 `RuntimeSessionExecutionController`，由 Backend Assembly 显式交付；RuntimeHost 的工作目录读取、执行忙碌态判断和在线模式重配置不再直接依赖旧 AgentSession/SessionManager，并保留目录自愈、全局切换预检、沙箱工具重建及不支持动态重配置时的错误行为。
- **Runtime Session Host Interaction**：新增不依赖 coding-agent UI 类型的 `RuntimeSessionHostInteractionContext` / `RuntimeSessionHostInteraction`，由 Backend Assembly 显式交付；RuntimeHost 的首次创建与同路径复用统一通过该 Port 绑定确认和沙箱授权能力，旧完整 `ExtensionUIContext` 仅由 Legacy Adapter 组装，原空实现和失败传播行为保持不变。
- **Runtime Session Model View**：新增不暴露可写 Registry 的 `RuntimeSessionModelView` 及旧 Session 适配器，由 Backend Assembly 显式交付；RuntimeHost 的图片能力判断、自动标题和输入预测不再直接读取旧 AgentSession model/modelRegistry，并保留当前模型优先、去重、三候选上限、凭证过滤、冷却和失败轮转行为。
- **Runtime Session Model Controller**：新增 `RuntimeSessionModelController` 及旧 Session 适配器，由 Backend Assembly 显式交付；RuntimeHost 的模型解析/切换、thinking level 和非共享 Registry 凭证刷新不再直接依赖旧 AgentSession，并保留 prompt `if-changed`、settings `always`、available-first/find-fallback 与切模后设置 reasoning 的原行为。
- **Runtime Session History Controller**：新增 `RuntimeSessionHistoryController` 及旧 Session 行为适配器，由 Backend Assembly 显式交付；RuntimeHost 的消息编辑、分支切换/删除、替换、fork 和在线会话命名不再直接编排旧 AgentSession/SessionManager，忙碌态、错误和上下文同步语义保持不变。
- **Runtime Session 身份、生命周期与历史读取 Port**：新增 `RuntimeSessionIdentityLifecycle`、`RuntimeSessionHistoryReader` 及旧 Session 适配器，并由 Backend Assembly 显式交付；RuntimeHost 的 sessionId/path/dispose 与完整历史读取不再直接依赖旧 AgentSession，行为保持不变。
- **Runtime Session Backend Assembly**：新增显式交付旧外围句柄与 Core Ports 的 `RuntimeHostSessionAssembly` / Backend 合同；RuntimeHost 不再自行创建 Legacy Ports，原 create-only Backend 通过独立兼容适配器继续工作。
- **Runtime Session 基础能力 Port**：新增独立 Turn Control、Event Stream 与 State Reader 合同及旧 Session 适配器；RuntimeHost 的 prompt/continue/abort、事件订阅和状态读取不再直接依赖旧 AgentSession，外围能力和生产行为保持不变。
- **显式 Session Resume 与未完成 Turn 恢复**：新增 `resumeAgentSession`、`ConversationRecoveryPolicy` 和 Greenfield Backend resume 路径；唯一未闭合 Turn 通过乐观版本追加稳定的 `turn_interrupted` 终态，非法事件序列 fail closed，且不重放模型、工具或进程内输入队列。
- **Greenfield Session Backend 与 Continue Turn**：新增显式并行的 Greenfield 后端、必需 Prompt Adapter、Kernel Runtime Factory、SessionEvent 订阅和 Repository 状态查询；Kernel 支持不追加伪用户消息的 continue Turn。默认 RuntimeHost 仍使用旧后端。
- **Greenfield Session 活动 Turn 输入队列**：新增独立 steer/follow-up 队列、逐条/全量消费模式和窄化 `TurnInputQueue` 合同；Agent Core 在既有模型循环边界消费输入，取消或错误保留未消费队列，关闭 Session 时释放队列。
- **独立 Session 观察事件与 Greenfield 宿主适配**：新增不依赖旧 `AgentSessionEvent` 的 `RuntimeSessionObservationEvent`；Agent Core Turn Engine 输出生命周期、文本/思考增量和工具生命周期，Turn Pipeline 以非持久化 envelope 发布，旧事件与 Greenfield Kernel Event 最终统一适配到现有 `SessionEvent`。
- **RuntimeHost 会话后端创建边界**：新增可注入的 `RuntimeSessionBackend` 与默认 `LegacyCodingAgentSessionBackend`；生产默认行为保持不变，为后续 Greenfield Session Backend 并行接入建立组合根切换点。
- **Capability Binding 与结构化 Tool Error**：新增按 `sourceId + capabilityId + revision` 标识模型所见能力的稳定绑定，以及从 Runtime Tool 到 Agent Tool Result 的结构化错误桥接。
- **Model Call Frame**：新增动态贡献合同与调用级 Frame 解析；Feature 实例保持长生命周期，而提示词和工具在每次模型调用前重新物化。
- **Agent Core Turn Engine Adapter**：新增 `AgentCoreTurnEngine`，将不可变 Runtime Snapshot、标准消息、模型流、Tool Loop、Tool Policy 和取消信号映射到 `@vetta/agent-core`；Runtime Tool 合同补充可取消执行、进度和阶段回报。
- **引用计数 Runtime Snapshot Provider**：新增 `AtomicRuntimeSnapshotProvider` 和 acquire/release lease；Snapshot 热更新只影响后续 Turn，retired Feature 资源在所有活动 Turn 释放后再 dispose。
- **隔离的 Greenfield Kernel 入口**：新增 `@vetta/runtime-core/kernel`，提供 Session 状态机、固定阶段 Typed Turn Pipeline、确定性 Feature Compiler、不可变 Runtime Snapshot 及存储、上下文和 Turn Engine Port；旧 `RuntimeHost` 生产入口保持不变。
- **`SessionEvent` 新增 `retry.start` / `retry.end`，`ErrorEvent` 新增 `retryAttempts`**：自动重试从此对宿主可见。`auto_retry_start` 此前被翻译成 `error` 事件（导致每次重试都在 UI 里刷一条错误），`auto_retry_end` 则根本没有翻译分支，宿主无从得知重试何时结束。宿主现在可以在退避期显示「正在自动重试 2/3」，并在最终失败的错误上说明「已自动重试 N 次」。
- **`flushPendingError(sessionId, state)`**：兑现挂起的 assistant 错误，见下方「错误延迟发射」。任何绕过 `RuntimeHost.prompt()` / `continue()` 自行驱动 agent 的路径都必须调用它，否则错误被永久吞掉。

- **`SubagentInfo` 增加 `queued` 状态、`todoProgress` 与 `title`**：透传 coding-agent 工作流子代理（ADR-0044）的排队状态、todo 进度与人类可读标题给宿主 UI。
- **顶层 `PromptRequest.promptRef` 与历史标记**：RuntimeHost 将结构化 Skill / Scene 引用透传给 coding-agent；历史转换从隐藏 expansion message 恢复 `prompt_ref_marker`，供宿主重载和编辑时重建选择状态，不把协议拼进用户正文。
- **Subagent 协议与宿主开关**：`SessionEvent` 增加 `subagents_update` / `SubagentInfo`；`RuntimeHost` 在 `conversation`/`project`/`cli` 场景启用 `enableSubagents`；`listSubagents` / `interruptSubagent` 供 UI 重放与中断。
- **`clearFinishedBackgroundTasks` 同时清理终端态子代理**：活动面板「清除已结束」一条 IPC 清 bash 已结束任务 + completed/failed/interrupted 子代理。
- **`RuntimeHost.killBackgroundTask`**：宿主可按 session/taskId 终止后台 bash 任务（`endedBy: user`），进程结束后 agent 收到用户手动终止的 task-notification。
- **RuntimeHost 固定 Skill 路径**：新增 `additionalSkillPaths`，创建会话和插件热重载时持续合并宿主提供的内置 Skill。
- **`AgentPluginRuntimeConfig.mcpServerContributions`**：插件作用域 MCP 贡献（`McpServerContribution` / `AgentPluginMcpServerConfig`），由 desktop 物化后交给 coding-agent `McpManager`（ADR-0040）。
- **Fork 血缘透出**：`SessionHistoryInfo` / `SessionStateSnapshot` 增加可选 `parentSessionPath` / `parentEntryId`；`listSessions` 与 `getState` 从 session header 透传，供桌面侧栏与来源跳转。

### Fixed

- **Greenfield 初始化发布边界**：Runtime Factory 会在最终 Assembly 投影成功后才提交初始化事务；若返回对象构造阶段抛错，已创建的 Kernel Session 与 Composition 资源仍按逆序释放。
- **会话标题与输入预测恒为中文，英文提问也拿到中文**：`generateAutoTitle` 的提示词写死「生成一个中文短标题」、system prompt 写死「只输出一个简短中文标题」，`generateNextPromptSuggestions` 与 `provide_prompt_suggestions` 的工具描述同样通篇中文——语言由提示词写死，与用户实际使用的语言无关。三处提示词改为英文撰写并显式要求「与用户消息同语言」输出（提示词自身的语言不再是语言信号）。同时放宽 `sanitizeAutoTitle` 的截断：原先一律砍到 14 个码点，对 CJK 合适，对英文不足两个词；改为含 CJK 走 14 字、纯拉丁走 40 字符且在词边界收尾，候选行长度阈值 30 → 60。

- **插件在会话创建之后注册工具时，宿主拿不到新的激活工具集**：`reconfigureAgentPlugins` 原先一律挂起到下一次 prompt 才 apply，空闲会话的 `getState().activeToolNames` 会长期停在插件 activate 之前的旧集合。现在空闲会话经 300ms 防抖提前 apply（streaming / bash 运行中仍走 turn 边界），并新增 `SessionEvent` `active_tools_update` 广播新的激活工具集；prompt 侧会先等待进行中的 apply 落定。
- **`RuntimeHost.prompt` 在开跑前确保 session cwd 存在**：desktop per-session 目录被删后 handle 仍存活时，mkdir 自愈，避免 bash/read 等工具报 Working directory does not exist。
- **一次限流在宿主侧广播出 6~7 条重复 error 事件（错误延迟发射，ADR-0057）**：coding-agent 默认重试 3 次，每次失败都是一条 `stopReason === "error"` 的 assistant message，叠加被误译成 `error` 的 `auto_retry_start`，宿主收到一串内容相同的错误。翻译 `message_end` 时无法预知后续是否重试（重试判定发生在之后的 `agent_end`），故改为把失败挂进 `MapAgentEventState.pendingError`，由 `RuntimeHost.prompt()` / `continue()` 的 `finally` 兑现成唯一一条 error——`session.prompt()` 内部 await 了 `waitForRetry()`，走到 finally 时重试必然已结束；放 `finally` 而非成功分支，是为了让 abort 与 throw 路径同样兑现。挂起项会被重试成功、后续成功的 `message_end` 或用户中止清掉。

### Changed

- **Agent Core Turn Engine 切换为无状态 Engine**：公共 `AgentCoreTurnEngine` 保持构造契约不变，生产执行改由 `runAgentTurn()` 驱动；动态 Frame、checkpoint、队列、工具进度、Runtime observation 与 tracing 由内部 Adapter 投影。Provider error 与取消分别走失败和 `AbortError`，不再伪装为正常 `completed` 终态；checkpoint 通过事件交付屏障保持消息先交付再持久化的顺序。
- **模型调用压缩的稳定切点合同**：Context Preparation 现在显式区分最新持久化 Document 与稳定的 compaction source；模型调用按 Turn 进入时分支计算切点、在最新分支提交和投影，assistant result/error 仍读取当前文档。消息身份协调同时把字符串与单一 text block 视为等价 UserMessage 表达，但保留时间戳和其他身份字段。
- **Greenfield Prompt Adapter 改为 Session 所有**：Adapter 由每个 Runtime Assembly 独立交付，不再由 Backend 全局共享，使 ResourceLoader、TodoStore 等有状态 Prompt 资源可按会话隔离。
- **Runtime Core 依赖倒置**：生产源码不再导入 `@vetta/coding-agent`；Legacy Session、历史、事件和平台沙箱工具适配器移至 `@vetta/coding-agent/runtime-host`，Desktop 通过显式 Composition Root 保持原生产行为。`RuntimeHost` 不再隐式创建具体 Backend/Catalog/History Reader，缺失组合时返回明确错误。
- **RuntimeHost Assembly 移除裸 Session**：`RuntimeHostSessionAssembly` 与内部 `SessionHandle` 不再暴露或保存旧 `AgentSession`；Legacy Backend 仅在组合时用旧 Session 构造各项 Port，RuntimeHost 注册完成后只持有稳定能力合同，并增加类型门禁防止裸 Session 字段回流。
- **Runtime Tool 输入类型泛型化**：`RuntimeToolDefinition<TInput>` 与 `RuntimeToolExecutionRequest<TInput>` 可从 TypeBox Schema 保留具体工具参数类型；异构 Runtime Snapshot 边界仍统一擦除为只读对象合同。
- **Tool Schema 完整冻结**：Feature Compiler 发布 Snapshot 前深拷贝并递归冻结 Tool JSON Schema，避免嵌套 Schema 在 Turn 执行期间被外部修改。
- **图像工具生命周期归插件（ADR-0048）**：移除 `RuntimeHostOptions.imageBackend` 与 RuntimeHost 的内置 `generate_image` / `edit_image` 注入；图像插件改用动态插件工具注册，禁用插件即可完整移除能力。
- **`RuntimeHost` 按职责拆分到 `src/runtime-host/`**：原 ~1.7k 行单文件拆为 `runtime-host`（会话编排）、`session-events`（事件映射）、`history`（历史/分支）、`peripheral-tasks`（自动标题/输入预测）、`plugin-debug`、`types`；包根 `index.ts` 从目录入口导出，对外 API 不变。
- **周边任务自动选模 + 失败轮转**：`autoTitleSession` / `nextPromptSuggestions` 不再依赖用户配置的「全局/周边模型」。改为优先使用当前会话模型，再从 `ModelRegistry.getAvailable()` 补足候选（最多 3 个）；调用失败或无可用结果时进程内冷却该模型并轮转下一个。无可用凭证时静默跳过。
- **`autoTitleSession` 日志增加 `durationMs`**：单次候选模型调用的 LLM 耗时写入成功/失败日志，便于对照 thinking 体量排查慢标题。

### Added

- **消息编辑 / 分支切换 API**：`HistoryEntry` 消息项携带 `entryId`/`parentId`/`branch`（user sibling）；`navigateForEdit` / `switchBranch` / `forkSession` 贯通 SessionFacade 与 RuntimeHost，供桌面端历史重编辑与同 session 分叉。`branch` 聚合跳过 skill 等透明节点，使编辑后的多版本能显示 `‹ i/n ›`。
- **HistoryEntry `settings_assist_marker`**：`entriesToHistory` 将 coding-agent 的 `custom_message`（`customType: settings_assist_instruction`）映射为 UI 标记（含可选 `tabId`），供 desktop 历史回放时显示「MCP配置协助」等页面对应徽章；不进入 LLM 上下文。
- `SessionHistoryInfo` 新增可选字段 `lastMessagePreview?: string`：`RuntimeHost.listSessions()` 把 coding-agent `SessionInfo.lastMessagePreview`（最后一条用户/助手消息的截断预览）透传给宿主，供桌面快捷面板「最近会话」列表展示会话末条预览。字段可选，既有调用方无需改动。
