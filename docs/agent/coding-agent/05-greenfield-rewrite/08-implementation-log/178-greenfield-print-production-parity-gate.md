# 第 178 轮：Greenfield Print 生产行为差分门禁

## 目标

第 177 轮已经把 Print 从 RPC 外围组合中分离，但高风险行为仍缺少标准 CLI 的 Legacy/Greenfield 差分证据。本轮以临时构建的独立 `vetta` CLI 可执行文件覆盖附件、工具调用、Provider 故障、Extension 错误和跨进程继续会话；只修复差分暴露出的兼容问题，不重构既有功能。

## 审计结论

### 1. Print 不应继承 RPC 的 Subagent 能力面

Greenfield Print 原先按 CLI 场景装配 Subagent 工具，而 Legacy Print 没有该工具面，导致 Provider Frame 中的工具集合不同。Subagent 能力仍属于普通 Greenfield RPC；Print 组合必须按宿主意图关闭它，才能保持现有功能合同。

### 2. Retry 不是普通 Continue

Provider 错误在 Agent Core 中表现为 `status=completed`、`stopReason=error`，错误 assistant 消息会正常持久化。普通 `continue()` 会把该错误消息作为上下文末尾再次交给模型，Agent 协议因此拒绝继续；直接删除持久化消息又会破坏历史审计。

正确语义是显式 `retry()`：历史中的错误 assistant 保持不变，只在本次模型上下文投影中排除最后一条失败 assistant。普通 continue、异步 continuation 和新 prompt 均不受影响。

### 3. Print 与 RPC 的失败返回语义不同

RPC 需要把最终失败抛给命令终态；Legacy JSON Print 则保留错误事件并正常返回，文本 Print 再根据最后一条 assistant 的停止原因决定退出码。共享 Turn Executor 若一律抛错，会把 JSON Print 的退出码从 0 改成 1。

因此 Turn Executor 保留默认抛错行为，同时允许 Print Host 显式选择“不抛出最终模型失败”。文本模式仍由既有 Print Mode 逻辑以退出码 1 结束。

## 实施内容

### 显式 Retry 上下文合同

Runtime Core 新增逐层一致的 retry 入口：

- `TurnPipeline.retry()` 在构造模型历史时排除最后一条 `stopReason=error` 的 assistant 信封。
- `AgentSession.retry()` 复用 Session 准入、取消和活动 Turn 所有权状态机。
- `GreenfieldRuntimeSession.retry()` 复用历史变更和压缩期间的并发门禁。
- `CodingAgentGreenfieldTurnExecutor` 的自动重试回调改用活动 Session 的 `retry()`，不再借用 `continue()`。

错误 assistant 仍保存在 Conversation 和 Session 投影中，重试成功消息追加在其后。

### Print 宿主兼容语义

- Greenfield Runtime 组合只在普通 RPC 意图启用 Subagent；Greenfield IM 与 Print 的既有能力面不扩张。
- Turn prompt options 增加宿主级 `throwOnFailure` 选择，默认值保持 RPC 的抛错行为。
- Greenfield Print Adapter 显式关闭最终模型失败抛出，由既有 Print Mode 决定 JSON/Text 的输出和退出码。

### 标准 CLI 差分矩阵

`agent-print-mode.test.ts` 通过临时 `bun build` 产出的独立 CLI 文件分别运行 Legacy 与 Greenfield，新增覆盖：

- 文本文件和图片 `@file` 输入及 Provider 最后一条 user payload。
- `read` 工具完整执行循环、JSON tool start/end payload 与第二次 Provider tool result。
- HTTP 503 的 SDK 内部重试、宿主自动重试事件和最终恢复。
- Provider 流断开的自动重试与最终恢复。
- 不可重试 401 在 JSON Print 中不触发自动重试并保持既有退出语义。
- 不可重试 401 在文本 Print 中保持退出码 1。
- Extension input handler 错误隔离、错误可观察性和模型 Turn 继续执行。
- 两个独立 CLI 进程通过 `--continue` 复用同一 Session 身份和完整上下文。

所有比较只规范化临时目录等动态值，不比较时间戳、后端诊断文字等非业务噪声。

## TypeBox / Zod 判断

本轮新增的是内部 retry 调用语义和测试观察投影，没有新增外部 wire、配置或持久化格式。Provider 测试服务器已有 Zod 请求校验，因此无需再引入 TypeBox/Zod。

## 测试与验证

- cli-app Print 差分：1 个文件、15 项通过。
- runtime-core Session Backend：1 个文件、14 项通过。
- coding-agent Turn Executor：1 个文件、5 项通过。
- `bun run check:quick` 通过，包含 standalone CLI build guard。
- 根目录 `bun run check` 通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。

## 明确未修改

- Print 默认 backend 仍是 Legacy，Greenfield 仍需显式选择。
- 普通 RPC 默认 Greenfield、IM 的 Runtime 选择和自动 Legacy 回退策略未变。
- Tool 的名称、描述、参数、返回值和执行功能未重构。
- Prompt、Skill、MCP、Knowledge、Memory、Extension wire 和会话文件格式未修改。
- Provider SDK 的内部重试次数与既有自动重试判定规则未修改。
- 没有删除 Legacy Print、RPC adapter 或旧会话兼容能力。

## 尚未闭合

本轮闭合了第 177 轮列出的 Greenfield Print 高风险行为差分，但尚未切换默认 backend。默认切换前仍应建立“默认 Greenfield、显式 Legacy”选择门禁，并用最终发布布局的安装产物重复验证基础 Print、失败语义和跨进程继续会话。

## 下一步

下一阶段应实施 Greenfield Print 默认切换：先把 Runtime 选择策略改为非 RPC Print 默认 Greenfield、显式 `--agent-runtime legacy` 可回退，再补齐默认/显式选择诊断、自动回退限制和最终安装产物进程门禁。若差分失败，只修复宿主选择或兼容适配，不改造 Agent 功能。
