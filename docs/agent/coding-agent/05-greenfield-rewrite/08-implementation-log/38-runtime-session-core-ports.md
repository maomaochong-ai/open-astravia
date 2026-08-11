# 阶段 38：Runtime Session 基础能力 Port

## 目标

将 RuntimeHost 最基础的 Turn、事件和状态读取路径从旧 `coding-agent.AgentSession` 直接调用中拆出，同时保持
旧生产行为、SessionFacade 返回结构和所有外围能力不变。

## 依赖审计

RuntimeHost 对旧 Session 的调用可以分为四组：

| 分组 | 主要调用 | 本阶段 |
| --- | --- | --- |
| Turn Control | prompt、agent.continue、abort | 迁移到 Port |
| Event Stream | subscribe、旧事件映射 | 迁移到 Port |
| State Read | getState、getMessages | 迁移到 Port |
| Peripherals | history/branch、model、plugin、todo、background task、subagent、session file | 保留旧 Session |

这次没有创建覆盖四组职责的统一 Session Interface。`SessionHandle` 暂时同时持有旧 Session 和三个基础 Port：
基础路径只访问 Port，未迁移的外围路径继续访问旧 Session。

## 新增合同

1. `RuntimeSessionTurnControl`
   - `prompt(RuntimeTurnPrompt)`
   - `continue()`
   - `abort()`
2. `RuntimeSessionEventStream`
   - 只输出已经适配为宿主稳定协议的 `SessionEvent`；
   - RuntimeHost 不再知道旧 `AgentSessionEvent`。
3. `RuntimeSessionStateReader`
   - `readState()` 只返回 SessionStateSnapshot 中由执行会话拥有的字段；
   - `readMessages()` 只返回标准 user/assistant/toolResult Message。

合同位于 `session-ports.ts`，不导入或暴露旧 AgentSession 类型。三个 Port 没有历史、分支、模型切换、插件、
Todo 或后台任务方法。

## Legacy Adapter

`legacy-session-ports.ts` 提供三个独立适配器和组合函数：

- Turn Adapter 保持旧 prompt 参数映射，包括 image、streamingBehavior、PromptRef、附件、extension source 和
  metadata；continue 仍委托 `session.agent.continue()`。
- Event Adapter 在一个旧 Session 上只建立一个底层订阅，旧事件只映射一次，再向多个 Port 订阅者扇出。
  这避免 `persistAssistantTurnTiming` 等映射副作用因多个 RuntimeHost 订阅者重复执行。
- State Adapter 保持 model、thinking level、streaming、message count、context usage、active tools 和 fork 血缘
  的原有读取方式。

## RuntimeHost 改造

- prompt 完成模型、reasoning、cwd 和图片能力预处理后，只调用 Turn Control。
- continue/abort 只调用 Turn Control。
- in-flight buffer 和外部订阅桥只订阅 Event Stream，不再直接处理 `AgentSessionEvent`。
- in-flight buffer 从 `message.final` 保存 error/aborted 终态，`agent_end` 时继续输出原有
  `RunningChangedReason`。
- getState/getMessages 只调用 State Reader。
- Session dispose/delete 时显式释放 Port 订阅，底层旧订阅在最后一个 Port listener 离开时关闭。

## 行为兼容门禁

- 旧 Session prompt 的最终参数完全不变。
- continue 与 abort 委托目标不变。
- 多个 RuntimeHost 订阅者共享一个旧 Session 底层订阅。
- renderer 重订阅仍回放当前 text delta。
- error 与 aborted 的 running-change reason 不变。
- SessionStateSnapshot 与 getMessages 的公开结构不变。
- dispose 仍释放 Session，同时释放唯一底层事件订阅。

## TypeBox / Zod 判断

本阶段新增的是进程内 TypeScript Port，没有外部 payload、配置文件或持久化 record。输入仍来自已经类型化的
`PromptRequest`，输出仍是现有 `SessionEvent` / `SessionStateSnapshot`，因此不引入 TypeBox/Zod。未来 Port
跨 IPC/RPC 时应在 Transport Adapter 校验，而不是把 Schema 依赖放进核心 Port。

## 明确未修改

- 没有修改旧 coding-agent Session、事件和 prompt 行为。
- 没有让 Greenfield Session 通过类型断言伪装成旧 Session。
- 没有迁移 history/branch、model registry、plugin、todo、background task 或 subagent。
- 没有改变 SessionFacade 的同步 getState/getMessages 合同。
- 没有切换生产 RuntimeHost 的默认后端。

## 下一步分析

RuntimeHost 现在仍在内部固定调用 `createLegacyRuntimeSessionCorePorts`，说明“后端创建”和“能力适配”尚未成为
同一个 Composition Root 结果。下一阶段应让 Backend 返回显式 Assembly：旧 Session 外围句柄与 Core Ports
分别声明，不再由 RuntimeHost 判断具体实现。

Greenfield 接入仍有两个真实缺口，不能用空实现绕过：

1. 当前 Greenfield State 依赖异步 Repository，而现有 SessionFacade.getState/getMessages 是同步合同；需要
   明确选择缓存型同步 Projection 或上层异步合同，不能在 Port 内隐藏未等待的 I/O。
2. RuntimeHost 的外围功能仍要求旧 Session。应继续按能力拆出 History、Model Configuration、Plugin、Task
   等独立 Port，而不是把这些方法追加到 Core Ports。

在解决同步 State Projection 前，可以先实施 Backend Assembly 和 Lifecycle/Identity Port，并保持 Greenfield
仅作为显式实验后端。

## 验证

- RuntimeHost/事件/Greenfield 定向测试：3 个文件，17/17 通过。
- Runtime Core 完整测试：11 个文件，58/58 通过。
- Runtime Core build typecheck：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
