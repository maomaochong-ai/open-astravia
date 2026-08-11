# 154：RPC 命令 Drain 与关闭事务

## 目标

在第 153 阶段完成活动 Turn 会话切换后，本阶段继续收紧 RPC 行级并发与进程关闭之间的合同。范围包括：

- 会话切换后紧接 prompt 的实际顺序；
- 会话切换与 abort 的归属；
- stdin EOF 与已接收命令重叠；
- Extension 异步请求 shutdown；
- shutdown、transport close 与 Session dispose 的 exactly-once 语义。

本阶段不增加 RPC 命令，不扩大 Greenfield IM Profile，也不改变 Tool、Skill、MCP、Provider 或会话格式。

## 真实基线结论

### 切换后 prompt

空闲 Session 上连续发送 `new_session` 与 prompt 时，Legacy 和 Greenfield 都会把 prompt 执行在目标 Session。

活动 Turn 上执行同样顺序时，Legacy 在重复真实进程测试中出现两种结果：

- prompt 在切换后成功并进入目标 Session；
- prompt 先收到 fire-and-forget ack，随后失败，Provider 没有收到第二次请求。

这说明旧实现没有单一可复制的行为合同，而是命令并发与旧 Agent 断开时序共同形成的竞态。Greenfield 通过第 153
阶段的活动 Session 准入稳定落到目标 Session，且不会把 prompt 交给已释放的源 Session。本阶段保留这一安全线性化，
没有为了匹配 Legacy 的一次随机失败而主动降级 Greenfield。

### Abort 与 EOF

切换后紧接 abort 时，两端都把 abort 作用于正在退出的源 Turn：旧 Provider 连接关闭，目标 Session 保持 idle，旧
终态事件不泄漏。

stdin 在已接收的 `new_session` 尚未完成时关闭，旧 RPC Mode 会立即调用 `dispose`。Legacy 因执行更快而经常丢失
切换响应，Greenfield 则会等待活动 Session 事务并输出响应。这不是后端功能差异，而是 RPC Mode 没有管理已接收命令
生命周期导致的清理竞态。

## 实施内容

### 已接收命令 Drain

`runRpcModeWithCapabilities` 现在只跟踪已经通过 JSONL transport 接收的行处理 Promise：

1. transport close 后先取消 Session 事件订阅；
2. 释放 Extension UI 与 Host Bridge，使不可能再获得响应的挂起桥接请求立即结束；
3. 等待所有已接收行处理器 settle；
4. 最后调用一次 `session.dispose()` 并退出进程。

因此已接收并开始执行的 `new_session` 会先完成并输出相关响应，随后才释放所有权。prompt 的模型 Turn 仍保持既有
fire-and-forget 语义，不纳入行处理 drain；活动 Turn 的终止继续由 Session dispose 负责，避免 EOF 等待永不结束的
Provider 流。

### 保留控制响应并发

本阶段没有把 RPC 输入改成全局串行 Pipeline。`host_response` 与 `extension_ui_response` 仍由各自桥接器直接处理，
可以在 prompt、工具执行或 Extension 对话框等待期间进入。否则 IM 工具调用和交互请求会形成自等待死锁。

### Exactly-once shutdown

Extension shutdown 现在由一个共享 Promise 拥有：

- `onShutdownRequested` 到达后立即安排 shutdown，不再依赖“之后恰好还有一个 RPC 命令完成”；
- 多个并发命令观察到同一请求时复用同一 Promise；
- `session.shutdown()` 和 transport close 各执行一次；
- shutdown 失败时发送一个 shutdown 错误并继续关闭 transport，最终仍进入统一 cleanup。

通过 microtask 启动 shutdown，可以让调用 `ctx.shutdown()` 的同步命令尾部先返回，同时避免等待下一条外部输入。

## 真实 CLI 门禁

新增 Legacy/Greenfield 真实 Vetta CLI 测试，覆盖：

1. 空闲 `new_session` 后立即 prompt；
2. 活动 Turn 的 `new_session` 后立即 prompt，并记录 Legacy 的两种历史竞态结果；
3. 活动 Turn 切换与 abort；
4. 活动 Turn 切换期间关闭 stdin，验证响应 drain 和所有权清理；
5. Extension Command 在异步边界后调用 `ctx.shutdown()`，验证 handler 顺序、一次 `session_shutdown` 和进程退出。

所有场景都会检查 Provider 请求、RPC 帧、Session 身份和 `.lock`/`.owner.lock` 清理。

## 安装产物

独立安装 CLI 产物增加“活动 Turn → `new_session` → stdin EOF”门禁。standalone 可执行文件会：

- 中止旧 Provider 请求；
- 完成已接收的 `new_session`；
- 在退出前输出唯一成功响应；
- 以 code 0 退出；
- 清理全部会话所有权锁。

## 类型校验选择

本阶段处理的是进程内 Promise 所有权和生命周期，不存在新的不可信 JSON 或配置解析边界，因此不引入 TypeBox/Zod。
现有 RPC frame validator 继续负责外部输入校验。

## 测试

- RPC Command Dispatcher / Mode：9 项通过；
- RPC 并发准入 Legacy/Greenfield 真实 CLI：5 项通过；
- 独立安装 CLI 产物：9 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

## 明确未修改

- 未把 RPC 命令改成全局串行队列；
- 未改变 prompt fire-and-forget ack 和 Turn 终态格式；
- 未增加或删除 Greenfield IM Profile 命令；
- 未改变 `new_session`、`switch_session`、fork 或 abort 的 Session 实现；
- 未改变 Provider、Tool、Skill、MCP、知识和 Extension 功能；
- 未引入新的生产依赖、通用 Middleware 或运行时 Schema。

## 结果

RPC transport、命令执行和 Session 释放现在形成明确的关闭顺序：停止接收输入，终止桥接等待，drain 已接收命令，
释放 Session，退出进程。Extension shutdown 不再依赖后续命令触发，也不会因并发完成而重复执行。该实现只协调生命
周期，没有把模型 Turn 或控制响应塞进粗粒度串行管道。

## 下一步

下一阶段应继续审计 fire-and-forget prompt 自身在关闭期间的资源归属，重点覆盖持有 Provider 流、等待
`host_response`、等待 `extension_ui_response` 和 shutdown/EOF 同时发生。目标是确认桥接请求、Turn、错误终态和进程
退出均能被 Session dispose 收敛，且不会产生未处理 Promise、重复终态或残留子进程。
