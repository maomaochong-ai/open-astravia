# 157：Session 可等待关闭事务与资源静默点

## 目标

第 154 至 156 阶段已经让 RPC transport 能停止接收命令、取消 transport 所拥有的长操作并 drain 在途处理器，但 Legacy
`AgentSession.dispose()` 仍只发出资源终止请求：后台 Bash 不等待进程 `close`，MCP shutdown Promise 被丢弃，Subagent 不等待
`waitForIdle()`，Session 文件锁却已经释放。

本阶段建立一个 Session-owned、可等待且幂等的关闭事务。成功标准是：异步关闭完成时，Legacy Session 所拥有的长生命周期资源已经
静默，随后才允许另一个进程取得会话所有权。

## 基线结论

- MCP Supervisor 与 Manager 已经提供 awaitable `shutdown()`，无需重写 MCP；缺口位于 `RuntimeManager` 和 `AgentSession` 的所有权接线。
- Subagent child handle 已有 `abort()` 与 `waitForIdle()`，只缺少父协调器的等待顺序和 AgentSession 子会话的 awaitable close 映射。
- 后台 Bash 的 `killAll()` 只调用 `taskkill`/进程组 kill，不能代表 OS 子进程和日志文件句柄已经关闭。
- Greenfield Session 已采用异步 dispose，本阶段只修复 Legacy 等价边界，不改变 Greenfield 业务实现。

## 实施内容

### AgentSession 关闭事务

`AgentSession` 新增幂等 `close(): Promise<void>`，重复调用共享同一个 Promise；既有 `dispose(): void` 保留为兼容入口，只负责启动
同一关闭事务并记录异常。关闭顺序为：

1. 断开 Agent 事件和外部 Session listener，移除父 Session 的 Subagent 可见引用；
2. 分别中止 retry、compaction、branch summary、前台 Bash 与 Agent，不因单项异常跳过其他清理；
3. 并行等待 Agent idle、`SessionEnd("dispose")`、Subagent dispose 和后台任务 shutdown；
4. 上述执行资源静默后，再等待 Runtime/MCP close；
5. 最后关闭 `SessionManager`，释放文件锁。

关键资源无法关闭时，事务仍会尝试其余清理并释放锁，随后以 `AggregateError` 拒绝，不能把超时伪装成成功；`SessionEnd` Hook
失败继续沿用既有 best-effort 语义，只记录诊断而不改变退出结果。

RPC Legacy Adapter 与 Legacy Knowledge Processing Port 改为等待 `session.close()`，不再用 `async` 外壳包装同步 dispose。

### 后台 Bash

`BackgroundTaskManager.shutdown()` 在调用瞬间停止接受新任务、关闭完成通知、终止所有运行中的进程树，并同时等待：

- 子进程 `close`/spawn error 终态；
- 对应日志 `WriteStream` 的 `close`/error 终态。

默认等待上限为 10 秒；超时时错误包含未关闭 task id 和 PID，避免把“已发送 kill”误报为“资源已关闭”。原 `killAll()` 继续保留为
同步兼容操作，不承担完成语义。

### Subagent

`SubagentCoordinator.dispose()` 现在幂等，并由自身拥有创建期 `AbortController` 与在途 child create/reopen 集合。关闭时：

- 先禁止新派发、清空排队与通知出口并 abort 创建 signal；
- 等待已经进入 factory 的创建操作完成；
- 创建结果若晚于父 Session 关闭，则由协调器立即 close，不能重新挂载；
- 对活动 child 先 abort，再等待 `waitForIdle()`，最后调用可选 `close()`；旧宿主仅实现同步 `dispose()` 时仍兼容。

默认 Subagent Session Factory 同时暴露同步 `dispose()` 与异步 `close()`，因此父 Session 能等待子 Session 自身的 MCP/Hook/锁释放。

### MCP Runtime

`RuntimeManager.close()` 先设置 closed 状态，再等待后台 MCP 初始化 Promise，最后等待 `McpManager.shutdown()`。初始化完成回调和
`buildRuntime()` 都检查 closed 状态，关闭期间完成的初始化不能重新注册插件 server 或重建 Tool/System Prompt。

原 `shutdown(): void` 保留为兼容包装，不再直接丢弃底层 Promise。

## 行为边界

- 未改变 Tool、MCP、Skill、Knowledge、Subagent 或后台 Bash 的业务功能和协议；
- 未让普通 EOF/dispose 新增 `session_shutdown` Extension 事件；既有显式 shutdown 触发条件不变；
- 未引入统一 Resource Registry、全局 Task Scheduler 或万能生命周期 Middleware；
- 未改变 Session 文件格式、RPC Frame 或 Capability Profile；
- 本阶段没有新增不可信配置/JSON/持久化解析边界，因此没有引入新的 TypeBox/Zod schema。

## 测试

- `BackgroundTaskManager`：真实长命令关闭、幂等 shutdown、关闭后拒绝 spawn、进程终态与日志句柄等待；
- `SubagentCoordinator`：abort → waitForIdle → close 顺序、幂等 dispose、父关闭期间 factory 晚返回结果的所有权；
- `RuntimeManager`：MCP 初始化/关闭竞争、禁止 late runtime rebuild、shutdown 恰好一次；
- `AgentSession`：资源静默后才关闭 Runtime，Runtime 关闭后才释放 Session lock；
- Legacy RPC/Knowledge Adapter：验证 awaitable close 委托；
- 真实 Vetta RPC CLI：模型调用真实 shell/bash 后台任务，关闭 stdin 后验证 PID 消失、exit code 0、ownership lock 为零；
- 独立安装 CLI 产物：重复同一后台进程与锁释放门禁。

定向测试、快速质量门禁和根目录完整检查均通过。

## 结果

Legacy Session 的资源生命周期不再以“已发送终止请求”为结束点。异步宿主可以等待确定的 Session close Promise；Session ownership
只会在 Agent、后台 Bash、Subagent、Hook 和 MCP 都完成清理后释放。同步 `dispose()` 调用方仍可继续工作，但需要确定释放完成的宿主应
使用 `close()`。

## 下一步

下一阶段应审计 Session 内“会话切换”与最终 `close()` 是否共享同一资源所有权规则，重点检查 `newSession`/`switchSession`/`fork`
过程中旧 Runtime、后台任务和 Subagent 是否允许跨会话残留。应先建立 Legacy 会话切换时的真实后台进程与 MCP 基线，再决定是复用本阶段
的窄关闭原语，还是明确禁止这些资源跨 Session identity 迁移；不得直接扩展为全局资源框架。
