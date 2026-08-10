# Changelog

All notable changes to `@vetta/ecosystem-adapter` are documented in this file.

## [Unreleased]

### Added

- **Callback Hook adapter 公共聚合合同**：公开 `aggregateHookDispatchOutcomes()`，`HookRunSummary.handlerType` 支持 `callback`；宿主 callback adapter 与 Codex/Claude command adapter 复用同一结果优先级、Stop 安全和运行诊断语义（ADR-0064）。
- **可变 Hook Dispatcher 与轮次贡献**：运行时可按 `id + revision` 原子注册、替换和释放 Skill frontmatter hook；在途 dispatch 使用稳定快照，旧 lease 不会误删新版本，`once` 状态按会话保留并可在新会话重置。
- **Hook 事件 `SessionEnd` / `PostToolUseFailure`**：中立 `HOOK_EVENT_NAMES` 与 `EcosystemHookRuntime.runSessionEnd` / `runPostToolUseFailure`；Claude profile 完整 wire（stdin reason/error、matcher、exit 2 反馈、`additionalContext`）；`SessionEnd` 不可阻断拆会话。Codex profile 仍为官方 10 事件，adapter `supports` 排除上述两项。
- **Vitest 配置**：本包 `vitest.config.ts` + `"test": "vitest --run"`；框架依赖统一在 monorepo 根 `devDependencies`，不在子包重复安装。
- **Hook 配置路径发现 `buildDefaultHookConfigLayers()`**：仅在 Vetta 根下镜像官方 `.codex` / `.claude` 布局——用户：`~/.vetta/.codex/hooks.json`、`~/.vetta/.claude/settings.json`；项目：`<cwd>/.vetta/.codex/hooks.json`、`<cwd>/.vetta/.claude/settings.json`、`settings.local.json`。source 带 `profileId` 隔离；**不读**顶层 `~/.codex` / `~/.claude` 或项目根 `.codex` / `.claude`，避免加载无关官方 hook。
- **Claude Code Hook profile `claude-code-hooks/2.1.211`**：独立 wire contract（不污染 Codex profile），支持 Vetta 宿主已触发的事件子集、`command` sync handler、matcher、`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` 展开、Windows 上禁止将 `.sh` 交给 cmd.exe；配置源为 settings 布局或显式 `hooks/hooks.json` + `CLAUDE_PLUGIN_ROOT`。
- **Hook 关键路径 info 日志（测试可观测）**：Codex adapter 加载时记 profile、handler 按事件计数与配置源；dispatch 对 SessionStart/SessionEnd/Stop/Compact 及 block/fail 打精简 info（不含 command/stdin）。
- 新增通用 Hook 调度内核，负责配置、匹配、并发、命令执行和归一化 effect 聚合。
- 新增可组合的 `EcosystemHookRuntime` / `EcosystemHookAdapter` 抽象，将会话状态、多适配器聚合和 Stop 安全策略从 Coding Agent 下沉到生态适配包。
- 新增 `codex-hooks/fca51f6` profile，支持最新版 10 个事件、事件级严格 wire contract、Codex matcher、`commandWindows`、handler 环境变量、完成顺序聚合、通用工具身份、PreToolUse 输入改写及 PermissionRequest 决策。

### Changed

- **`SessionEnd` 宿主语义与 Claude wire 解耦**：中立 API 使用 Vetta `SessionEndCause`（`new_session` / `switch_session` / `fork_session` / `dispose`），不再暴露 Claude 的 `clear` / `other` 等 `reason`。Claude profile 在 encode/matcher 内映射为 stdin 与 settings matcher 的 `reason`（`new_session`|`fork_session`→`clear`，`switch_session`→`resume`，`dispose`→`other`）。
- Codex / Claude adapter 仍只解析宿主传入的配置层；默认层由 `buildDefaultHookConfigLayers` 仅提供 Vetta 嵌套的 `.codex` / `.claude` 路径。`isCodexOwnedSource` 认任意 `/.codex/hooks.json`（或 `profileId`）；`isClaudeOwnedSource` 认任意 `.claude/settings*.json`、插件 `hooks/hooks.json` 或 `profileId`。
- Coding Agent 宿主通过生态无关运行时接入工具前后、压缩前后、会话开始和停止边界；具体 Codex 字段、名称与输出语义只存在于 Codex profile。
- Codex adapter 只维护最新版 `codex-hooks/fca51f6`，不保留旧版协议选择分支。
- Codex `hooks.json` 和 Hook stdout 的外部数据校验改用 Zod schemas，其中 stdout 按事件使用 strict object；移除重复的 record、字段白名单和可选字段类型判断，内部领域事件仍使用 TypeScript 判别联合。
