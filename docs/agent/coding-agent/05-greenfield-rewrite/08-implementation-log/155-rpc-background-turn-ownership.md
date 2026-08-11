# 155：RPC 后台 Turn 所有权与关闭收敛

## 目标

第 154 阶段已经让 RPC Mode drain 已接收的行级命令，但 `prompt` 为保持即时 ack，模型 Turn 仍以
fire-and-forget 方式运行。本阶段补齐该后台 Promise 在 Provider、Host Bridge、Extension UI Bridge 与
shutdown/EOF 重叠时的所有权。

本阶段只调整 RPC 生命周期协调，不改变 prompt 协议、Session API、Provider、Tool、Skill、MCP、知识或会话格式。

## 基线与问题

`createRpcCommandDispatcher` 原先会启动 `turn.prompt()`、附加失败处理并立即返回成功响应。该 Promise 不属于
`runRpcModeWithCapabilities` 的行处理集合，因此 transport cleanup 无法知道 prompt 是否已经 settle。

直接在 `session.dispose()` 后等待 prompt 的第一次实现暴露了更底层的真实差异：

- Greenfield Session dispose 会收敛活动 Session；
- Legacy `AgentSession.dispose()` 负责断开监听、释放锁和子资源，但不负责 abort 活动模型流；
- 因此只增加等待会让 Legacy 的 held Provider prompt 永久挂起，真实 CLI 最终被测试守卫以 `SIGTERM` 终止。

这说明关闭事务不能假设所有 Session dispose 都包含 Turn abort，也不能为了避免挂起而继续让进程提前退出。

## 实施内容

### 后台任务登记

RPC Command Dispatcher 增加内部 `onBackgroundTask` 选项。prompt 仍执行原有流程：

1. 调用 `turn.prompt()`；
2. 保留原有关联失败响应；
3. 把已附加失败处理的 Promise 登记给 RPC Mode；
4. 立即返回成功 ack。

该选项只传递 Promise 所有权，不暴露 Provider、Tool Loop 或 Session 实现，也没有形成通用任务框架。

### 关闭事务

RPC Mode 使用私有集合跟踪仍未 settle 的后台 prompt。关闭顺序现在是：

1. 取消 Session 事件订阅；
2. dispose Extension UI 与 Host Bridge，使不可能再收到响应的等待立即结束；
3. drain 已接收的 RPC 行处理器；
4. 仅在仍有后台 prompt 时调用现有 `turn.abort()`；
5. dispose Session 与 Runtime 资源；
6. 等待登记的后台 prompt 全部 settle；
7. 退出进程。

Turn abort 位于行处理 drain 之后，因此不会破坏第 154 阶段已经建立的 `new_session` 等命令完成语义；它又位于
Session dispose 之前，因此 held Provider 流能够先被中止。空闲 EOF 不会产生额外 abort。

### Bridge 迟到响应

Host Bridge 与 Extension UI Bridge 的生产实现已经在 dispose 时清空 pending map，本阶段没有重写它们。测试补充验证：

- dispose 后的 `host_response` 返回未命中；
- dispose 后的 `extension_ui_response` 返回未命中；
- Promise 只 settle 一次，不保留 pending 请求。

## 真实 CLI 合同

Legacy 与 Greenfield IM 使用真实 Vetta CLI 验证以下关闭场景：

1. Provider 已输出部分事件并保持连接时关闭 stdin；
2. `im_send_attachment` 已发出 `host_request`、等待 `host_response` 时关闭 stdin；
3. Extension Command 等待 `extension_ui_response` 时关闭 stdin。

两端结果一致：

- 进程以 code 0 退出；
- Provider held request 被关闭；
- prompt 即时成功响应保持唯一；
- 关闭期间没有额外 `agent_end` 或关联失败终态；
- Extension UI 等待按既有取消合同返回 `false`；
- `.lock` 与 `.owner.lock` 数量归零。

直接使用 Host Bridge 的 RPC Mode 单元测试仍验证原有错误合同：若 prompt 能直接观察到 Bridge reject，会输出唯一关联失败
响应。真实 Tool Loop 会把关闭取消收敛在 Turn abort 中，因此不会向已关闭会话追加第二终态。

## 安装产物

独立安装 CLI 产物新增 Host Bridge 关闭门禁：模型调用 `im_send_attachment`，产物输出 `host_request` 后不提供
`host_response`，直接关闭 stdin。产物会中止 Turn、settle prompt、以 code 0 退出，并清理全部会话所有权锁。

## 类型校验选择

本阶段没有新增不可信 JSON、配置或持久化解析边界，因此不引入 TypeBox/Zod。现有 RPC Frame Validator 继续负责外部输入
校验。

## 测试

- RPC Dispatcher、Mode 与 Bridge：17 项通过；
- Legacy/Greenfield 真实 CLI 命令准入与关闭差分：8 项通过；
- 独立安装 CLI 产物：10 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

## 明确未修改

- 未改变 prompt 即时 ack 和关联错误格式；
- 未把 RPC 命令改成全局串行 Pipeline；
- 未改变 Host Bridge 或 Extension UI Bridge 的协议；
- 未改变 Legacy `AgentSession.dispose()` 的通用语义；
- 未增加或删除 RPC Profile 命令；
- 未改变 Provider、Tool、Skill、MCP、知识、Extension 或会话功能；
- 未增加生产依赖或运行时 Schema。

## 结果

RPC Mode 现在同时拥有已接收行处理器和由这些行启动的后台 prompt。transport 关闭不再早于 prompt settle，也不会因为
Legacy dispose 不负责 abort 而挂起。Turn 中止、Bridge 取消、Session 释放和进程退出形成可验证的单一关闭事务。

## 下一步

下一阶段应审计 RPC 之外仍可能脱离调用栈的长期异步工作，优先检查自动重试、后台 Bash、压缩和 Extension 后台回调是否
都由 Session/Runtime dispose 收敛。先建立真实进程退出与资源基线，仅对确认存在所有权缺口的任务增加协调，不建立通用
全局任务调度器。
