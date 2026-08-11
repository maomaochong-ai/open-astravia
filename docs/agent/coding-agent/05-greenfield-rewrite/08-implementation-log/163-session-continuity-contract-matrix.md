# 第 163 轮：Session 连续性合同矩阵

## 目标

把此前分散在 Legacy identity transition、Greenfield active-session host、memory rollover 和真实 CLI
测试中的连续性事实收敛为一个明确的二维合同：

```text
会话语义：Identity replacement | Storage continuation
运行后端：Legacy              | Greenfield
```

本轮只修复由合同证明的架构缺口，不改变 Tool、Prompt、Todo、memory-mode、RPC wire 或持久化格式。

## 合同矩阵

| 语义 | Legacy | Greenfield | 必须保持的事实 |
| --- | --- | --- | --- |
| Identity replacement（`new_session`） | 真实 Vetta CLI | 真实 Vetta CLI | 源后台进程终止；源 ownership 释放；目标 ownership 持有；目标 Todo 为空；关闭后目标 ownership 释放 |
| Storage continuation（memory rollover） | 真实 Vetta CLI | 真实 Vetta CLI | 后台进程继续运行；Todo 内容继续存在；源文件保留；目标文件创建；ownership 原子转移；只产生一次 `session_path_changed`；CLI 关闭后后台进程和目标 ownership 均释放 |

这里刻意不要求两类语义采取相同的资源策略：

- replacement 是新的 Conversation identity，Conversation 级易失资源必须静默并重新创建；
- continuation 是同一个运行中 Session 的存储换卷，只重绑定 document identity 和 ownership，不能重建
  Tool/Prompt/Skill/MCP Runtime，也不能终止仍属于该 Session 的后台工作；
- replacement 继续保持既有 RPC 行为，不额外伪造 `session_path_changed`；目标 identity 通过命令响应后的
  `get_state` 观察；
- rollover 的路径事件是存储续接协议的一部分，必须恰好对应一次明确的换卷事务。

Todo fixture 在触发 rollover 前被标记为完成。这样合同验证的是 Todo 状态持久化，而不会把“未完成 Todo
自动续跑”这一独立产品语义混入存储续接矩阵。

## 发现的真实缺口

首次运行矩阵时，Legacy replacement 能在发布目标 identity 前终止后台进程；Greenfield replacement
调用 `BackgroundCommandService.dispose()` 后立即继续释放 Session ownership，进程树仍在退出过程中。
真实 Windows CLI 随后删除 fixture 时得到 `EBUSY`，证明 Session 的资源静默点并未真正可等待。

另一个审计缺口位于 `CodingAgentGreenfieldActiveSessionHost`：稳定事件订阅虽然能跨 Session 切换，
但其中一个外部 listener 抛错会阻断后续 listener。底层 Session EventSink 已隔离监听器，宿主转发层没有
保持同一合同。

## 实施

### 1. 可等待的后台命令静默点

- `BackgroundCommandService` 保留同步 `dispose()` 兼容入口，并新增 `shutdown(): Promise<void>`。
- `shutdown()` 先以 `dispose` 原因停止全部运行任务，再等待每个任务收到真实进程退出回调。
- `GreenfieldSessionExecutionRuntime.dispose()` 改为等待 `shutdown()`。
- Greenfield Session 资源 disposer 和 Composition 总释放路径均等待 Execution Runtime，之后才释放
  Conversation ownership 和 Repository。

这没有改变 `task_stop`、后台通知、任务状态或同步 `dispose()` 的既有行为，只补齐了异步 Session 关闭所需的
可等待生命周期合同。

### 2. Active Session 观察者隔离

`CodingAgentGreenfieldActiveSessionHost` 在转发当前 Session 事件时逐 listener 隔离异常并记录 warning。
抛错 listener 不会阻断同一事件的其他观察者，也不会影响切换后新 Session 的事件。

### 3. 真实 CLI 四象限差分

`agent-runtime-provider-differential.test.ts` 现在使用真实 Vetta RPC CLI、真实 Provider Tool Loop、真实
Todo/Shell Tool 和真实 ownership 文件验证两个后端的两类语义。测试不直接调用内部 Store、Manager 或
Runtime 实现，因此覆盖的是宿主真正能够观察的行为。

## 验证

- `packages/runtime-tools/test/coding/command/background-command-lifecycle.test.ts`
  - 新增异步进程退出 fixture，确认 `shutdown()` 已发出 stop 但在 exit callback 前不会完成。
- `packages/coding-agent/test/runtime-core/greenfield-active-session-transition-host.test.ts`
  - 确认抛错观察者在切换前后均不阻断后续观察者。
- `packages/cli-app/test/agent-runtime-provider-differential.test.ts`
  - replacement × Legacy/Greenfield；
  - storage continuation × Legacy/Greenfield；
  - Todo、后台进程、document path、path event、ownership 和最终关闭全部纳入同一矩阵。

## TypeBox / Zod 判断

本轮没有新增外部 JSON、配置或持久化记录。`shutdown()`、观察者转发和连续性矩阵均为进程内 TypeScript
合同；RPC 与 Provider fixture 继续使用已有协议类型和校验，因此不引入新的 TypeBox/Zod Schema。

## 明确未修改

- 没有删除 Legacy Backend 或兼容入口。
- 没有改变 `new_session`、memory rollover、Todo 或后台 Tool 的用户可见功能。
- 没有改变 Conversation V2、Legacy JSONL、RPC Frame 或 SessionEvent 格式。
- 没有把 replacement 与 continuation 合并成一个万能切换流程。

## 下一步

第 164 轮应把 replacement 轴从 `new_session` 扩展到真实 CLI 的 `switch_session` 和 `fork`，重点验证目标
Todo 恢复、源后台任务静默、失败回滚和排队命令归属；通过后再合并重复的 Legacy-only 资源测试。该阶段仍
只补兼容合同和被合同证实的缺口，不删除 Legacy，也不重写会话功能。
