# 第 86 轮：Greenfield Session-local Subagent Runtime

## 1. 本轮目标

本轮完成第 85 轮留下的最后一个 RuntimeHost Assembly 缺口，同时保持既有子代理产品行为：

1. 建立不依赖具体 Agent、模型、工具、MCP 和存储实现的 Subagent Runtime。
2. 复用既有七个子代理控制工具的描述、TypeBox Schema、参数和结果语义。
3. 让 Explorer 与 Workflow 子代理通过 Profile 组合不同能力，而不是在协调器中写死工具。
4. 明确父子 Session ownership、独立持久化路径、并发、通知、生命周期和释放边界。
5. 将后台命令与子代理组合为真实 `backgroundWorkController`，使 Greenfield RuntimeHost Assembly
   完整 Ready。
6. 修复后台通知只能写入上下文、不能自动触发模型继续处理的问题。

## 2. 架构结论

子代理不是 Kernel 的内置业务，也不是一个特殊 Tool。它由三层组成：

```text
runtime-core
  └─ 异步上下文驱动的 Session continuation

runtime-subagents
  ├─ 类型注册与 Profile
  ├─ 并发队列与状态机
  ├─ Child Handle / Factory Port
  ├─ 生命周期与通知
  └─ 与具体 Agent 实现无关的控制合同

CLI Composition Root
  ├─ Explorer / Workflow Profile
  ├─ Greenfield Child Session Factory
  ├─ Coding Agent 工具适配
  ├─ Ecosystem SubagentStart / SubagentStop
  ├─ 父上下文、Todo、模型、MCP 与存储接线
  └─ RuntimeHost backgroundWorkController
```

`runtime-subagents` 不依赖 `coding-agent` 或 `cli-app`。它只认识 `SubagentChildHandle`、
`SubagentChildFactory`、`SubagentTypeDefinition` 和 `SubagentLifecycle` 等 Port。具体子会话由
Composition Root 创建，因此协调器不会绑定某一种 Session、存储格式或工具注册表。

## 3. 独立 Runtime Subagents 包

新增 `@vetta/runtime-subagents`，职责包括：

- `SubagentTypeRegistry`：注册可用子代理类型及其不透明 Profile。
- `SubagentCoordinator`：维护 pending、queued、running、completed、failed、interrupted 状态。
- 单个 spawn 的并发拒绝与批量 dispatch 的 FIFO 排队。
- 通过 id、`task_name` 或 `/root/<task_name>` 解析同一子代理。
- `sendMessage`、`followUp`、`interrupt`、事件驱动 `wait` 和清理。
- 每个 generation 只投递一次的完成通知。
- 完成通知短时间批处理，避免多个子代理同时结束时重复唤醒父 Session。
- 终态 Child Handle 上限和统一 dispose。
- SubagentStart / SubagentStop 生命周期 Port，以及 Stop Hook continuation 上限。

批量 Workflow 继续保留既有语义：新批次清理同类型的 completed/failed 条目，但不清理 interrupted
条目；已完成任务名可在新批次中复用，校验失败不会预留半批子代理。

## 4. 既有七个控制工具保持不变

Greenfield 没有重新编写子代理工具协议。`coding-agent` 中原有工具改为依赖
`SubagentCoordinatorPort`，再由 Greenfield Adapter 转成 Runtime Tool Definition：

1. `spawn_agent`
2. `dispatch_workflows`
3. `wait_agent`
4. `list_agents`
5. `interrupt_agent`
6. `send_message`
7. `followup_task`

工具描述和 TypeBox Schema 仍来自原 TypeScript 工具定义；输入校验、错误、文本结果、wait 的消费语义和
Workflow 的通知驱动约束没有重写。此次变化是依赖倒置和运行时适配，不是功能重构。

## 5. Explorer 与 Workflow Profile

### Explorer

- 不继承父会话完整对话。
- 使用既有 Explorer persona。
- 只暴露 `read`、`grep`、`glob`、`find`、`ls`、`dir_tree`。
- 不暴露 shell、write、edit、todo 或子代理控制工具。
- 继续共享父 Composition 的 cwd、模型服务和 MCP 来源；MCP 仍按当前会话规则动态物化。

其中目录树工具的公开名称是既有 `dir_tree`，没有把内部变量名 `tree` 当成新工具名。

### Workflow

- 在创建时继承父会话活动分支的模型上下文快照。
- 使用既有 Workflow persona。
- 预填 dispatch 提供的 Todo。
- 使用 CLI Coding Tool Scope，包括当前平台命令工具、读写编辑和 Todo。
- 与父会话共享工作目录，但拥有独立 Session、工具执行覆盖层、后台任务和 Todo 状态。
- 不注册七个子代理控制工具，保持单层派生，避免递归子代理树。

## 6. 父子 Session 与存储 ownership

每个 Child 都是真实 Greenfield Session，不是父 Turn 内的临时 Promise：

- 父会话只持有 Coordinator 和 Child Handle。
- Child Factory 创建独立 Greenfield Composition 与 Session。
- 子会话文件写入
  `<conversationDir>/.subagents/<parentSessionId>/<childSessionId>.conversation.jsonl`。
- 顶层会话目录不会把子会话误列为普通根会话。
- Child Handle 负责 prompt、消息注入、follow-up、abort、事件、usage、Todo 和 dispose 适配。
- 父 Session dispose 时先释放协调器和所有 Child，再释放父 Session 资源。

当前持久化的是子会话 transcript；父进程重启后重建 Coordinator 索引尚未实现，因此不能把“文件存在”误认为
“根会话恢复后已自动恢复子代理控制状态”。

## 7. 异步上下文驱动的续轮

真实组合测试暴露了一个 Kernel 边界问题：后台通知可以写入 Context Buffer，也能调用空 `continue()`，
但空 continuation 没有携带触发它的 Context Record。Agent Core 看到最后一条仍是旧 assistant 消息时，
不会再次调用模型。

本轮将该能力修正为 Kernel 原语：

- `AgentSession.requestContinuation(records)` 接收异步 `SessionContextRecord`。
- 活动 Turn 期间的多个请求合并为下一次 continuation，并合并对应 Context。
- Session 空闲时立即串行启动 continuation。
- Context 在该 Turn 起始阶段写入 `context.appended`，model-visible 记录同时进入本次模型输入。
- Session close 后拒绝待处理请求并清理对应 Context。
- `GreenfieldRuntimeResourceContext.deliverAsyncContext()` 只通过该入口交付，不伪造普通用户消息。

因此子代理和后台命令完成后都能在没有用户再次输入的情况下唤醒模型；并发仍由 Session 状态机统一仲裁。

## 8. 生命周期、观察事件与通知

- 创建前运行既有 `SubagentStart` Hook；block/stop 会阻止子会话开始。
- 结束前运行 `SubagentStop` Hook；允许受上限保护的 continuation。
- 子代理状态变化发布 `subagents_update` Session Observation。
- terminal 结果生成为既有 `<subagent_notification>`，以 model-visible Context 交付父 Session。
- `wait_agent` 先消费某 generation 时，自动通知不会重复投递同一结果。
- interrupt 保留 transcript，并允许 `followup_task` 在同一 Child Session 上继续。

## 9. RuntimeHost Assembly

`GreenfieldBackgroundWorkController` 现在同时组合：

- Session-local Background Command Service。
- Session-local Greenfield Subagent Runtime。

真实 CLI Greenfield Composition 已交付 `backgroundWorkController`，加上第 85 轮的
host interaction、execution、todo 和 configuration 后，`assessRuntimeHostSessionAssembly()` 返回
`ready: true`。

这只表示 RuntimeHost Port 已完整，不等于 Desktop 生产后端已经切换。Desktop 仍应经过显式 opt-in、恢复策略
和端到端验证后再改变默认路由。

## 10. TypeBox / Zod 判断

七个 Tool 输入继续使用原有 TypeBox Schema，因为它们本来就是模型/JSON 边界。新的 Coordinator、
Child Handle、Lifecycle 和 Profile 都是进程内强类型 Port，没有重复引入 Zod。

本轮没有新增不受信任的持久化格式解析；子会话仍使用既有 Conversation Codec。因此没有为了“统一校验”而增加
第二套 Schema。

## 11. 测试与验证

本轮新增或扩展测试覆盖：

1. 空闲 Session 异步续轮、活动 Turn 请求合并、关闭后拒绝，以及 Context 合并透传。
2. 批量校验原子性、FIFO 并发、id/name/path 查询、wait 与自动通知 exactly-once。
3. interrupt 后同 transcript follow-up。
4. completed/failed 清理、interrupted 保留和已完成 Workflow 任务名复用。
5. 旧 Coordinator 与 Workflow 工具测试继续通过。
6. 真实 Explorer Child 的只读工具面、独立文件路径和完成通知自动唤醒根会话。
7. 真实 Workflow Child 的父上下文继承、Todo、可写工具面和禁止递归派生。
8. 真实 Greenfield RuntimeHost Assembly Ready。
9. 既有动态 Tool、Prompt、MCP、Knowledge、持久化、恢复和压缩组合测试继续通过。

## 12. 明确未修改

- 没有改变七个子代理控制工具的名称、描述、TypeBox Schema 和文本结果合同。
- 没有重写 Explorer/Workflow persona。
- 没有把 MCP、模型或 Workspace 静态复制进 Coordinator。
- 没有允许 Workflow 递归 spawn 子代理。
- 没有把子会话混入根会话目录。
- 没有切换 Desktop 默认生产 Backend。
- 没有实现进程重启后的 Coordinator/Child 控制状态重建。

## 13. 下一步

下一阶段应把“Assembly Ready”推进到可迁移的宿主行为，而不是继续扩张 Subagent 内核：

1. 定义并实现根会话恢复时的 Subagent 索引恢复策略，明确 running 状态在进程崩溃后的归一化规则。
2. 对 RuntimeHost 的 background work、history、model、configuration 和 interactive resume 做完整差分门禁。
3. 在 Desktop Candidate 中增加显式 Greenfield opt-in 的真实交互验证，但继续保留 Legacy fallback。
4. 只有恢复、关闭、并发和多会话隔离全部通过后，才评估默认路由切换。
