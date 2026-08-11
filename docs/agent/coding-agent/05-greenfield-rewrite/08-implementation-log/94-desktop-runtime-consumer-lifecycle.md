# 第 94 轮：Desktop Runtime 多消费者生命周期

## 1. 目标

第 93 轮已经证明真实 Desktop 主进程可以通过独立 Vetta CLI 完成 Greenfield 会话闭环。本轮把
验证范围扩展到同一进程内的三个真实 `RuntimeHost` 消费者：

1. 交互会话；
2. Scheduler 自动化会话；
3. Batch 并发受限任务。

本轮不重构 Scheduler 或 Batch 的业务功能，只补齐它们作为共享 Runtime 消费者的生命周期合同，
并验证 Desktop 退出时的所有权顺序。

## 2. 生命周期边界

新增 Desktop 进程级 `DesktopRuntimeLifecycle`，状态为：

```text
idle -> running -> stopping -> stopped
```

该状态只属于 Desktop Composition Root，不下沉到 `runtime-core`：

- `RuntimeHost` 仍是宿主无关的会话内核门面；
- Desktop 决定什么时候停止接收新消费者工作；
- Scheduler 和 Batch 各自释放自己持有的订阅、队列、超时器和活动会话；
- 最后才由 Desktop 释放共享 `RuntimeHost` 与 Greenfield Backend Pool。

`beginSharedRuntimeShutdown()` 在 `before-quit` 的同步部分先把状态切到 `stopping`。从这一刻起，
`getSharedRuntime()` fail-closed，不允许退出流程或迟到回调重新创建 Runtime。共享 Runtime 的异步
释放使用同一个 Promise，重复调用不会并发执行两次清理。

## 3. Scheduler 与 Batch 消费者收敛

### 3.1 Scheduler

Scheduler 现在显式维护：

- 是否继续接受新执行；
- 活动执行 Promise；
- 活动任务的 `taskId`、`sessionId`、`sessionPath` 和订阅释放函数；
- 幂等 shutdown Promise。

shutdown 时先停止 cron 调度并拒绝新任务，再中止活动会话、释放事件订阅，最后等待已经进入执行器
的 Promise 收敛。

### 3.2 Batch

Batch 现在显式维护：

- 是否继续接受新 Job；
- 活动 Job Promise；
- 活动任务及其 Runtime、会话、超时器和 AbortController；
- 每个项目的排队任务；
- 幂等 shutdown Promise。

shutdown 时先关闭入口并清空排队任务，随后删除活动任务映射、取消超时器、中止活动会话并等待
Job 收敛。`drainQueue()` 在停止状态下不会再启动排队任务；Session 创建与 prompt 之间也再次检查
停止状态，覆盖退出和异步创建重叠的竞争窗口。

## 4. Desktop 退出所有权顺序

真实主进程退出顺序调整为：

```text
Runtime lifecycle -> stopping
  -> 注销 Scheduler / Batch IPC
  -> 关闭 Local Debug RPC
  -> 停止宿主监听器
  -> 并行停止 Scheduler 与 Batch 消费者
  -> 停止 IM sidecar
  -> 释放共享 RuntimeHost
  -> 释放 Greenfield Backend Pool
  -> 结束监控与遥测
```

关键约束是“生产者入口先关闭、消费者先收敛、共享资源最后释放”。这样消费者不会在 Runtime 已销毁
后继续调用，也不会在退出期间从队列启动新 Session。

## 5. 真实多消费者 Canary

Runtime Canary 新增开发态 Debug 定义 `runtime-canary.consumers.start`。它复用真实
`SchedulerService` 和 `BatchTaskService`：

1. 创建并立即运行一个 Scheduler 任务；
2. 创建包含两个目录、并发度为 `1` 的 Batch 项目；
3. 等待 Scheduler 与第一个 Batch Session 进入活动态；
4. 确认第二个 Batch 任务仍处于排队态；
5. 返回三个消费者的 Session 身份与路径。

本地 Provider 对 Scheduler 和 Batch 的固定提示保持流连接不结束，使两个消费者在请求退出时仍然
活动。Runner 随后再保持一个交互会话的用户问题操作，调用 `lifecycle.quit`，并验证：

- 交互、Scheduler、Batch 三个 Session 锁全部释放；
- Batch 排队任务没有向 Provider 发出请求；
- Local Debug RPC endpoint 已删除；
- Provider 已停止；
- Desktop 退出码为 `0`。

外部 CLI JSON、Fixture 文件和 Debug 输入继续使用 Zod 校验；进程内部的执行器状态使用 TypeScript
合同，不重复引入运行时 Schema。

## 6. 真实进程暴露的异步合同缺陷

首次多消费者 Canary 中，Scheduler 和 Batch 的新 Session 都在首次 prompt 前失败：

```text
Session already has an active turn
```

根因不是 Session 之间共享了 Turn 状态，而是旧合同：

```ts
renameSessionById(sessionId: string, name: string): void
```

内部实际执行异步 Conversation Document 写入，却用 fire-and-forget 隐藏了 Promise。Scheduler 和
Batch 在调用重命名后立即 prompt；Greenfield History Controller 正在执行互斥文档变更，因此正确
拒绝了并发 prompt。

修复后合同为：

```ts
renameSessionById(sessionId: string, name: string): Promise<void>
```

两个消费者在 prompt 前显式等待重命名完成。该修改没有改变会话命名或任务行为，只把原本真实存在的
异步边界暴露给调用方，同时让重命名失败能够进入消费者既有错误处理。

## 7. 测试与验证

定向测试覆盖：

- Desktop Runtime 状态转换、重复 shutdown 和停止后 fail-closed；
- Scheduler 活动执行中止、订阅释放、停止后拒绝新任务；
- Batch 活动任务中止、排队任务清空、停止后不 drain；
- Scheduler 与 Batch 必须等待异步重命名完成后才能 prompt；
- RuntimeHost 异步重命名合同；
- Canary Provider 的保持连接；
- 多消费者 Debug 定义和 CLI Runner 编排。

执行结果：

```text
packages/runtime-core/test/runtime-host/session-backend.test.ts
  11 tests passed

packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-lifecycle.test.ts
packages/desktop-app/src/main/scheduler/task-executor.test.ts
packages/desktop-app/src/main/batch-tasks/batch-task-executor.test.ts
packages/desktop-app/src/main/app-debug/runtime-canary/provider.test.ts
packages/desktop-app/src/main/app-debug/runtime-canary/consumer-definitions.test.ts
packages/desktop-app/src/main/app-debug/runtime-canary/runner.test.ts
  6 files, 14 tests passed
```

真实进程验证：

```powershell
bun run verify:ui:start -- --runtime-canary greenfield
bun run verify:ui:debug -- runtime-canary
```

结果：

- 三类消费者在同一真实 Desktop 进程内同时活动；
- Scheduler 与 Batch Session 身份和文件路径彼此隔离；
- Batch 第二个任务保持排队且没有启动；
- 退出时活动请求被取消，所有 Session 锁释放；
- Debug endpoint 与 Provider 正常清理；
- Desktop 退出码为 `0`。
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包含 Biome、monorepo `tsgo`、CLI 独立类型检查、
  Desktop 独立 `tsc`、Admin project build 和全部 quality guards。

## 8. 明确未修改

- 没有改变 Scheduler 的 cron、一次性任务、记录或事件语义。
- 没有改变 Batch 的并发、暂停、恢复、超时、产物或通知语义。
- 没有为 Canary 新增第二套 Scheduler/Batch 执行 API。
- 没有把 Desktop 生命周期状态放进 `runtime-core`。
- 没有改变普通 Desktop 的默认 Runtime 选择。
- 没有让 Debug Runtime 进入打包生产环境。
- 没有把排队任务视为活动 Session 或在退出时启动它。

## 9. 下一步

下一阶段应进入独立可执行产物闭包验证：

1. 验证编译后的 Desktop Main、Vetta CLI 与 Greenfield 模块不依赖源码路径或开发态隐式解析。
2. 在独立产物中复跑真实 Provider、交互会话和多消费者退出门禁。
3. 验证 Tool 描述、Skill、MCP 配置、模型配置和运行时资源均进入正确产物边界。
4. 增加进程重启后的 Session Catalog 与未完成会话恢复检查。
5. 只有上述门禁稳定后，才评估扩大 Greenfield 默认启用范围；本阶段不切换默认值。
