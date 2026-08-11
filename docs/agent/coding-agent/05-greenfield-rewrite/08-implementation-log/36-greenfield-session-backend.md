# 阶段 36：Greenfield Session Backend 与 Continue Turn

## 目标

建立一个不伪装成旧 `coding-agent.AgentSession` 的 Greenfield 并行后端，贯通 prompt、continue、abort、
SessionEvent 订阅、Repository 状态查询和释放；同时审计它与当前生产 RuntimeHost 之间的真实阻断。

## 审计结论

阶段 33 的 `RuntimeSessionBackend` 名称看起来像完整后端，实际合同只有一个 `create()`，默认返回类型则是
旧 `AgentSession` 别名。RuntimeHost 创建后仍直接访问旧会话的：

- 模型注册表、模型和 thinking level；
- SessionManager、JSONL 历史、分支和会话命名；
- Todo、后台任务和子代理；
- 插件重配置、工具集合和 Context Usage；
- 扩展绑定、bash 状态及 Agent 内部消息替换。

因此不能让 Greenfield 对象用类型断言冒充旧 Session，也不能为了通过 RuntimeHost 创建一个覆盖所有外围
职责的新 God Interface。本阶段把 Greenfield 后端作为显式并行组合边界实现，默认生产路径继续使用
`LegacyCodingAgentSessionBackend`。

## 架构

```text
Host PromptRequest
  -> required GreenfieldPromptAdapter
  -> SessionInput + SessionSendOptions
  -> GreenfieldRuntimeSession
  -> Kernel AgentSession / TurnPipeline

KernelEvent
  -> per-session EventSink
  -> Greenfield SessionEvent Adapter
  -> isolated subscribers

GreenfieldRuntimeFactory
  -> AgentSession + ConversationRepository + optional disposer
```

`GreenfieldPromptAdapter` 与 `GreenfieldRuntimeFactory` 都是必需注入项。Backend 不知道附件、PromptRef、Skill、
metadata、模型切换或 Profile 如何实现，也不会静默丢弃这些字段；具体 Composition Root 必须完整适配后才能
启用对应宿主场景。

## 已实施

1. 将 `RuntimeSessionBackend` 泛型化：
   - 裸类型参数继续对应旧 RuntimeHost 的创建参数和旧 Session；
   - Greenfield 可以指定自己的创建参数和会话门面；
   - 默认旧实现及 RuntimeHost 类型不变。
2. 新增 `GreenfieldRuntimeSessionBackend`：
   - 通过 `GreenfieldRuntimeFactory` 获取已组合的 Kernel Session 与 Repository；
   - 每个 Session 拥有独立事件 Sink；
   - 返回独立 `GreenfieldRuntimeSession`，不继承、不包装成旧 AgentSession。
3. 新增 Greenfield Session 门面：
   - `prompt()` 先调用必需的 Prompt Adapter；
   - 活动 Turn 未指定 `streamingBehavior` 时在 Adapter 前拒绝，避免失败请求触发展开副作用；
   - `continue()`、`abort()` 委托 Kernel 生命周期；
   - `subscribe()` 输出现有 `SessionEvent`，单个监听器异常不影响 Turn 或其他监听器；
   - `getState()` / `getMessages()` 从 Kernel 状态和 Repository 组合读取；
   - `dispose()` 幂等关闭 Session，并释放组合根声明的独占资源。
4. 补齐真正的 Continue Turn：
   - `AgentSession.continue()` 不创建伪 user message；
   - Turn Pipeline 只写入 `turn.started`，从已存 Conversation 继续组装上下文；
   - Context Provider 的当前输入变为可选，能够区分 prompt 与 continue；
   - 继续 Turn 的 assistant 消息和终态仍按既有事件合同持久化。

## 未完成 Turn 的恢复策略

本阶段确认恢复不能等同于 `createSession()`，也不能在进程重启后自动重放模型或工具。下一步恢复合同必须
遵循以下规则：

1. `create` 与 `resume` 使用显式不同入口，禁止遇到已有文件时隐式覆盖或猜测。
2. resume 先扫描持久事件，识别存在 `turn.started` 但没有 completed/cancelled/failed 的 Turn。
3. 通过 Repository 乐观版本追加一个稳定的 interrupted failure/cancellation 终态，再暴露 idle Session。
4. 不自动重放模型调用或工具调用，避免重复外部副作用。
5. 不恢复进程内 steer/follow-up 队列，也不合成 user message；未消费队列从未持久化。
6. 多个同时未闭合 Turn、事件顺序错误或版本冲突必须 fail closed，不修改原文件。

当前 `AgentSession.create()` 仍是新建语义，`FileConversationRepository.load()` 仍只是读取语义。本阶段没有在
没有恢复合同和差分基线的情况下把二者混成一个“自动恢复”入口。

## TypeBox / Zod 判断

本阶段没有在 Backend 内引入 TypeBox/Zod。`PromptRequest` 已经是 RuntimeHost 的进程内类型，真正来自
RPC/IPC/配置文件的不可信数据应在对应传输 Adapter 解析；Greenfield Backend 强制要求 Prompt Adapter，
避免用 Schema 校验替代附件、Skill、metadata 和模型选择所需的业务适配。未来新增持久恢复记录或独立
RPC payload 时，应在 record/transport 边界使用现有 Schema 方案。

## 测试覆盖

- Prompt Adapter 收到完整请求与 sessionId。
- 活动 Turn 的无行为 prompt 在 Adapter 执行前拒绝。
- Kernel observation / assistant message 映射为现有 SessionEvent。
- 监听器异常隔离。
- Repository-backed state 与 messages。
- continue 不追加伪 user message。
- 活动 Turn 显式 follow-up 入队，abort 后保留。
- cancel 映射为 aborted + agent_end。
- Session 与组合根资源幂等释放，释放后拒绝 prompt。
- 旧 RuntimeHost 后端特征测试继续通过。

## 明确未修改

- 没有把 Greenfield Backend 直接注入当前 RuntimeHost。
- 没有给缺失的模型、历史、Todo、后台任务、子代理、插件或分支能力提供空实现。
- 没有修改默认 `LegacyCodingAgentSessionBackend` 或任何生产组合根。
- 没有改变 PromptRef、附件、图片、Skill、metadata、模型或 thinking 行为。
- 没有自动恢复或重放未完成 Turn。

## 验证

- 定向 Vitest：2 个文件、12/12 通过。
- `bun run test:pkg runtime-core`：10 个测试文件、48/48 通过。
- `bunx tsgo --noEmit -p packages/runtime-core/tsconfig.build.json`：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：本阶段源码、测试、Lint 和架构守卫通过；全量类型检查仍被既有基线问题阻断：
  - `packages/capability-runtime/test/registry.test.ts` fixture 缺少 `workspacePath` / `archivedProjects`；
  - `packages/runtime-tools/test/**` 的 5 处旧差分 fixture 存在 `AgentTool` 参数方差错误。

## 下一步

下一阶段应先把 RuntimeHost 对旧 AgentSession 的直接依赖按能力拆为小 Port，优先拆 Turn Control、Event
Stream 和 State/History Read，不创建统一大接口。Legacy Adapter 实现全部 Port；Greenfield 只在等价
能力通过合同测试后逐项实现。与此同时实现显式 resume 与 interrupted Turn Recovery，并用真实文件
Repository 验证版本冲突、重复恢复和“不重放副作用”。完成这些门禁后，才能让 RuntimeHost 接受
Greenfield Backend 的显式实验 Profile。
