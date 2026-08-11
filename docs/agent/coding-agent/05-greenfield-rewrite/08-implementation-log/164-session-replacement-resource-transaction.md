# 第 164 轮：Session Replacement 资源事务

## 目标

把第 163 轮只覆盖 `new_session` 的 identity replacement 合同扩展到真实 CLI 的
`switch_session` 与 `fork`，并固定成功、失败和恢复路径中下列可观察事实：

- Conversation identity 与 ownership；
- Session-local Todo；
- 后台命令；
- replacement 后的命令准入；
- fork entry 的 RPC 可发现性。

本轮继续以 Legacy 为行为事实源。Greenfield 只修复差分证明的兼容性缺口，不改变旧会话功能、RPC
数据格式或 Conversation 持久化格式。

## Legacy 事实基线

### 成功 `switch_session`

- source 后台命令在切换时终止；
- source ownership 释放，target ownership 由当前进程持有；
- 活动路径切换到 target；
- target 使用自己的 Todo 域，空 target 不继承 source Todo；
- target 可以立即接纳新 prompt；
- CLI 关闭后 target ownership 释放。

### 目标锁冲突

Legacy 的失败合同不是“所有资源完全回滚”：

- `switch_session` 返回带原 correlation id 的失败响应；
- source identity、source ownership 和 source Todo 保留；
- target ownership 仍属于占锁进程；
- source 可以继续接纳 prompt；
- source 已运行的后台命令会被终止，不会恢复。

原因是 Legacy 在尝试提交新 identity 前先 quiesce 旧 identity 资源；目标激活失败时会重新激活可继续使用的
资源域，但不会恢复已经终止的外部进程。Greenfield 必须保留这一既有细节，不能把架构重构变成行为重构。

### 成功 `fork`

- 宿主先通过 `get_fork_messages` 取得真实 user entry id，再提交 `fork`；
- fork 生成并激活新的 Conversation identity；
- source 后台命令终止，source ownership 释放，fork target ownership 持有；
- fork target 不继承 source 的进程内 Todo；
- fork target 可以立即接纳新 prompt；
- CLI 关闭后 target ownership 释放。

## 发现的兼容性缺口

### 1. Greenfield RPC Profile 遗漏 `get_fork_messages`

Greenfield RPC adapter 已实现 `readForkMessages()`，dispatcher、frame validator 和 RPC 类型也都支持
`get_fork_messages`，但 `GREENFIELD_IM_RPC_PROFILE` 没有声明该命令。结果是宿主虽然可以发送 `fork`，
却无法通过旧 RPC 功能取得合法 entry id。

本轮只把既有命令加入 Greenfield Profile，没有新增协议或改变响应格式。

### 2. 锁冲突时后台命令行为与 Legacy 不同

Greenfield 原先只有 transition 成功并 dispose source Session 时才停止后台命令。目标 ownership 获取失败时，
source Session 被保留，后台命令也继续运行；Legacy 则已经在目标提交前终止该命令。

本轮在 Active Session Host 的 replacement 边界显式 quiesce source background commands，使 `new`、
`resume`、`fork` 使用相同的 replacement 静默点。

### 3. 停止命令时产生额外 task notification

直接调用 `BackgroundCommandService.shutdown()` 会在任务结束时向当前 Session 回注 `task-notification`，而
Legacy identity quiesce 会先断开旧通知再停止任务。该额外通知可能抢占失败恢复后的下一次 prompt 生命周期。

`GreenfieldSessionExecutionRuntime.quiesceBackgroundCommands()` 现在：

1. 临时解除 background task observation/notification 订阅；
2. 等待全部后台进程真实退出；
3. 重新绑定订阅，使失败恢复后的 source Session 仍可创建和观察新的后台任务。

最终 Session dispose 仍解除订阅后执行 shutdown，不重新激活观察者。

## 实施边界

- `CodingAgentGreenfieldActiveSessionHost` 只编排 replacement 时序，不直接访问进程句柄或 Tool 实现。
- `GreenfieldRuntimeComposition` 暴露窄的 `quiesceSessionBackgroundCommands(sessionId)` 组合能力，按
  Session id 路由到其 execution runtime。
- `GreenfieldSessionExecutionRuntime` 拥有 BackgroundCommandService 和通知订阅，因而只有它负责静默、
  等待和重新绑定。
- Todo、Conversation ownership 和 fork history 继续由各自既有所有者管理，没有合并成万能 transaction。

## 测试

### 真实 CLI 差分

新增 `agent-runtime-session-replacement-differential.test.ts`，逐项运行 Legacy 与 Greenfield：

1. 成功 `switch_session`：路径、source/target ownership、source 后台退出、target Todo 隔离、后续 prompt、
   最终 ownership 释放；
2. 锁冲突 `switch_session`：失败响应、source identity/ownership/Todo 保留、target ownership 保留、后台退出、
   source 后续 prompt 和最终进程清理；
3. 成功 `fork`：`get_fork_messages` 可达、真实 entry id、路径与 ownership 转移、后台退出、Todo 隔离、
   后续 prompt 和最终 ownership 释放。

### 单元测试

`greenfield-active-session-transition-host.test.ts` 新增目标 acquisition 失败测试，确认 background quiesce 在
resume 前发生，同时 source Session 仍是活动 Session 且未被 dispose。

## 验证结果

- `packages/coding-agent/test/runtime-core/greenfield-active-session-transition-host.test.ts`：12 项通过。
- `packages/cli-app/test/agent-runtime-session-replacement-differential.test.ts`：3 项通过。
- Legacy 与 Greenfield 的三条 replacement 观察结果完全一致。

## TypeBox / Zod 判断

本轮没有新增外部输入、配置、RPC Frame 或持久化记录。`get_fork_messages` 使用既有 RPC schema；新增
quiesce 方法是进程内 TypeScript 合同，因此不引入 TypeBox/Zod。

## 明确未修改

- 没有删除 Legacy Backend、Legacy RPC adapter 或回退入口。
- 没有改变 `switch_session`、`fork`、Todo、后台 Tool 或 ownership 的用户功能。
- 没有把失败切换改成“恢复已终止外部进程”的新语义。
- 没有改变 Conversation V2、Legacy JSONL、RPC response 或 SessionEvent 格式。
- 没有合并 replacement 与 memory rollover；storage continuation 仍保留运行期资源。

## 下一步

第 165 轮建议扩展 replacement 的并发准入合同：使用真实 CLI 固定在 `switch_session` / `fork` 已排队时
到达的 prompt、Extension command 和可变 Session 命令究竟绑定 source 还是 target，并验证失败恢复后同一
FIFO 队列没有丢失、重放或跨 identity 写入。只有差分证明缺口时才修改 Greenfield；仍不删除 Legacy。
