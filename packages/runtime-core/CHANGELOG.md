# Changelog

All notable changes to `@vetta/runtime-core` are documented in this file.

## [Unreleased]

### Added

- **`SubagentInfo` 增加 `queued` 状态、`todoProgress` 与 `title`**：透传 coding-agent 工作流子代理（ADR-0044）的排队状态、todo 进度与人类可读标题给宿主 UI。
- **顶层 `PromptRequest.promptRef` 与历史标记**：RuntimeHost 将结构化 Skill / Scene 引用透传给 coding-agent；历史转换从隐藏 expansion message 恢复 `prompt_ref_marker`，供宿主重载和编辑时重建选择状态，不把协议拼进用户正文。
- **Subagent 协议与宿主开关**：`SessionEvent` 增加 `subagents_update` / `SubagentInfo`；`RuntimeHost` 在 `conversation`/`project`/`cli` 场景启用 `enableSubagents`；`listSubagents` / `interruptSubagent` 供 UI 重放与中断。
- **`clearFinishedBackgroundTasks` 同时清理终端态子代理**：活动面板「清除已结束」一条 IPC 清 bash 已结束任务 + completed/failed/interrupted 子代理。
- **`RuntimeHost.killBackgroundTask`**：宿主可按 session/taskId 终止后台 bash 任务（`endedBy: user`），进程结束后 agent 收到用户手动终止的 task-notification。
- **RuntimeHost 固定 Skill 路径**：新增 `additionalSkillPaths`，创建会话和插件热重载时持续合并宿主提供的内置 Skill。
- **`AgentPluginRuntimeConfig.mcpServerContributions`**：插件作用域 MCP 贡献（`McpServerContribution` / `AgentPluginMcpServerConfig`），由 desktop 物化后交给 coding-agent `McpManager`（ADR-0040）。
- **Fork 血缘透出**：`SessionHistoryInfo` / `SessionStateSnapshot` 增加可选 `parentSessionPath` / `parentEntryId`；`listSessions` 与 `getState` 从 session header 透传，供桌面侧栏与来源跳转。

### Fixed

- **插件在会话创建之后注册工具时，宿主拿不到新的激活工具集**：`reconfigureAgentPlugins` 原先一律挂起到下一次 prompt 才 apply，空闲会话的 `getState().activeToolNames` 会长期停在插件 activate 之前的旧集合。现在空闲会话经 300ms 防抖提前 apply（streaming / bash 运行中仍走 turn 边界），并新增 `SessionEvent` `active_tools_update` 广播新的激活工具集；prompt 侧会先等待进行中的 apply 落定。
- **`RuntimeHost.prompt` 在开跑前确保 session cwd 存在**：desktop per-session 目录被删后 handle 仍存活时，mkdir 自愈，避免 bash/read 等工具报 Working directory does not exist。

### Changed

- **图像工具生命周期归插件（ADR-0048）**：移除 `RuntimeHostOptions.imageBackend` 与 RuntimeHost 的内置 `generate_image` / `edit_image` 注入；图像插件改用动态插件工具注册，禁用插件即可完整移除能力。
- **`RuntimeHost` 按职责拆分到 `src/runtime-host/`**：原 ~1.7k 行单文件拆为 `runtime-host`（会话编排）、`session-events`（事件映射）、`history`（历史/分支）、`peripheral-tasks`（自动标题/输入预测）、`plugin-debug`、`types`；包根 `index.ts` 从目录入口导出，对外 API 不变。
- **周边任务自动选模 + 失败轮转**：`autoTitleSession` / `nextPromptSuggestions` 不再依赖用户配置的「全局/周边模型」。改为优先使用当前会话模型，再从 `ModelRegistry.getAvailable()` 补足候选（最多 3 个）；调用失败或无可用结果时进程内冷却该模型并轮转下一个。无可用凭证时静默跳过。
- **`autoTitleSession` 日志增加 `durationMs`**：单次候选模型调用的 LLM 耗时写入成功/失败日志，便于对照 thinking 体量排查慢标题。

### Added

- **消息编辑 / 分支切换 API**：`HistoryEntry` 消息项携带 `entryId`/`parentId`/`branch`（user sibling）；`navigateForEdit` / `switchBranch` / `forkSession` 贯通 SessionFacade 与 RuntimeHost，供桌面端历史重编辑与同 session 分叉。`branch` 聚合跳过 skill 等透明节点，使编辑后的多版本能显示 `‹ i/n ›`。
- **HistoryEntry `settings_assist_marker`**：`entriesToHistory` 将 coding-agent 的 `custom_message`（`customType: settings_assist_instruction`）映射为 UI 标记（含可选 `tabId`），供 desktop 历史回放时显示「MCP配置协助」等页面对应徽章；不进入 LLM 上下文。
- `SessionHistoryInfo` 新增可选字段 `lastMessagePreview?: string`：`RuntimeHost.listSessions()` 把 coding-agent `SessionInfo.lastMessagePreview`（最后一条用户/助手消息的截断预览）透传给宿主，供桌面快捷面板「最近会话」列表展示会话末条预览。字段可选，既有调用方无需改动。
