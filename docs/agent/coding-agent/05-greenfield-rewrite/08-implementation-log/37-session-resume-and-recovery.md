# 阶段 37：显式 Session Resume 与未完成 Turn 恢复

## 目标

先清理阻断全量检查的既有类型基线，再让阶段 36 已定义的恢复策略成为可执行合同：新建与恢复必须使用
不同入口；恢复最多收敛一个未完成 Turn；绝不自动重放模型、工具或未持久化输入队列。

## 基线修复

1. `capability-runtime` 的 Project List 测试 fixture 已同步当前合同：补齐 `workspacePath` 与
   `archivedProjects`，移除已经不存在的 `currentProjectPath`。
2. `resolveActiveToolNames` 原本要求完整 `AgentTool[]`，但实际只读取 name、scope、requires 与 mode 元数据。
   这会让参数 Schema 不同的工具在 `execute` 参数逆变位置产生 5 处伪类型错误。本阶段新增窄化的
   `ToolActivationMetadata` 输入合同，保留所有运行时激活行为，不再要求无关的 execute 签名兼容。
3. 重新生成并核对 admin TanStack Router 类型树后，根级检查通过；生成结果与仓库当前文件一致，没有形成
   额外源码改动。

## 恢复合同

```text
resume(sessionId)
  -> Repository.load
  -> ConversationRecoveryPolicy.plan
       -> ready: 不写入
       -> interrupt(turnId): 乐观版本追加 turn.failed(turn_interrupted)
       -> 非法生命周期: turn_protocol，零写入
  -> 返回 idle AgentSession
```

新增 `ConversationRecoveryPolicy` Port，并提供默认 `FailInterruptedTurnRecoveryPolicy`。默认策略按顺序验证
持久事件：

- `turn.started` 只能在没有活动 Turn 时出现；
- message、compaction 与 terminal 必须属于当前活动 Turn；
- terminal 关闭当前 Turn；
- 扫描结束后零个活动 Turn 直接 ready；唯一活动 Turn 生成 interrupt 计划；
- 重叠 Turn、无 start 的事件、Turn ID 错配或跨 Session 事件全部 fail closed。

Policy 只生成领域计划，不访问存储、不获取 Snapshot，也不执行模型。`TurnPipeline.resumeSession()` 负责在
当前 Conversation version 上追加标准 `turn.failed`，错误码固定为 `turn_interrupted`。版本冲突直接向上
返回，失败写入不会被吞掉。

## 显式入口

1. `AgentSession.create()` / `createAgentSession()` 只创建新 Conversation。
2. `AgentSession.resume()` / `resumeAgentSession()` 只加载并恢复已有 Conversation。
3. `GreenfieldRuntimeFactory` 与 `GreenfieldRuntimeSessionBackend` 同时提供显式 `create` 和 `resume`，组合根不再
   能把“打开已有会话”藏进名为 create 的实现中。
4. Factory 恢复期间产生的映射事件会暂存到 Session 初始化结束，并在首个订阅者注册时交付；避免
   `turn_interrupted` 在 Backend 返回、宿主尚未来得及订阅之前丢失。后续无订阅者的普通实时事件仍按既有
   非重放语义处理。
5. 旧 `RuntimeSessionBackend`、`LegacyCodingAgentSessionBackend` 与生产 RuntimeHost 没有改变。

## 副作用边界

- 恢复不调用 `RuntimeSnapshotProvider.acquire()`。
- 恢复不调用 `TurnEnginePort.execute()`，因此不会重放模型或工具。
- 恢复不生成 user message，也不恢复只存在于旧进程内的 steer/follow-up 队列。
- 恢复终态先持久化，再发布观察事件；EventSink 失败仍不改变持久化结果。
- 重复顺序恢复是幂等的；并发恢复只有一个 writer 成功，另一个收到 Repository version conflict。

## TypeBox / Zod 判断

本阶段没有新增外部输入格式或新的持久化 record。恢复终态复用现有 `StoredSessionEvent` 与
`FileConversationRepository` 的 TypeBox Schema 校验，因此不在 Kernel Policy 内重复引入 TypeBox/Zod。
Policy 处理的是 Repository 已验证的领域对象；若未来恢复参数来自 IPC/RPC，应在对应传输 Adapter 校验。

## 测试覆盖

- 唯一未完成 Turn 被追加一个稳定的 interrupted failure，并保留原消息。
- 已完成 Conversation 不追加事件。
- 重复恢复只产生一个终态。
- 重叠 Turn、无 start terminal 与 terminal Turn ID 错配均 fail closed。
- 恢复过程中 Snapshot 与 Turn Engine 调用次数为零。
- Greenfield Backend 只调用显式 resume Factory，不回落到 create。
- 真实 JSONL Repository 关闭、重开后重复恢复仍幂等。
- 两个并发恢复 writer 使用相同 version 时只有一个成功，另一个得到 version conflict。

## 明确未修改

- 没有自动重放未完成模型响应或工具调用。
- 没有把失败 Turn 的输入自动重新排队。
- 没有改变既有 create、prompt、continue、abort 或旧会话加载行为。
- 没有把 Greenfield Backend 注入生产 RuntimeHost。
- 没有在 RuntimeHost 上增加覆盖全部旧 AgentSession 职责的大接口。

## 下一步分析

当前真正阻止 Greenfield Backend 接入 RuntimeHost 的已不是 Turn 生命周期，而是 RuntimeHost 对旧
`coding-agent.AgentSession` 外围能力的直接访问。下一阶段应按调用点拆出三个最小 Port，并由 Legacy Adapter
先实现合同：

1. Turn Control：prompt、continue、abort；
2. Event Stream：subscribe/unsubscribe；
3. State Read：最小运行状态与消息读取。

History/branch、model registry、plugin、todo、background task 和 subagent 不应塞进上述 Port；它们继续作为
独立能力逐项迁移。先让 RuntimeHost 的基础 Turn 路径只依赖这三个 Port，再增加 Greenfield 合同测试和显式
实验 Profile，避免一次替换全部外围功能。

## 验证

- capability-runtime fixture、runtime-tools/coding-agent 激活合同：66/66 通过。
- Runtime Core 完整测试：11 个文件，55/55 通过。
- Runtime Storage 完整测试：2 个文件，11/11 通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
