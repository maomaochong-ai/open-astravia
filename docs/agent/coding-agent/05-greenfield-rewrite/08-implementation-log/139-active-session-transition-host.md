# 第 139 轮：Active Session Transition Host 与 RPC 会话事务

## 目标

把 Greenfield IM Runtime 从“进程生命周期内只能持有一个固定 Session”推进到“宿主持有可事务替换的活动 Session”，让 RPC 的 `new_session`、`switch_session` 与 `fork` 使用真实 Greenfield 后端，同时保持会话所有权、事件订阅、Extension Context 和失败回滚的一致性。

本阶段只重构会话宿主边界，不改变会话业务语义，也不提前关闭尚未完成差分验证的 Extension Command 回退。

## 分析结论

会话切换不是修改一个 `session` 变量，而是一个宿主级事务，至少包含：

1. 等待当前 Session 空闲并执行可取消的 before 事件。
2. 创建、恢复或 fork 目标 Session，取得目标文件所有权。
3. 为目标 Session 准备新的 Extension Event/Action/Context Binding。
4. 原子发布活动 Session 与 Binding，并迁移稳定事件订阅。
5. 执行 after 事件；提交前任一步失败都恢复旧 Session。
6. 提交成功后再释放旧 Binding、旧 Session 和 ownership。

“发布事务”与“旧资源清理”必须分开。目标 Session 已对外可见后，即使旧资源清理失败，也不能回滚到可能已被部分释放的旧对象；此时保留新 Session 活动状态并报告“事务已提交但清理失败”。

旧 `newSession.setup(SessionManager)` 是真实兼容合同，不能用空实现替代。兼容桥应在临时 Legacy SessionManager 上执行 setup，写出完整会话快照，再通过已有迁移边界导入 V2 Conversation，最后由 Greenfield Backend 恢复并接管。

本轮没有新增 TypeBox 或 Zod。RPC 外部 Frame 已由既有 TypeBox 边界校验；setup 导入继续复用已校验的 Legacy-to-V2 Migration。新增对象均为仓库内部强类型合同，再加一层 Schema 不会提供额外边界安全。

## 实施内容

### 1. 独立 Active Session Transition Host

新增 `CodingAgentGreenfieldActiveSessionHost`，职责限定为：

- 持有当前活动 `GreenfieldRuntimeSession`，不接管 Backend 的 Session 实现。
- 串行化 `new/resume/fork`，避免并发切换竞争活动指针和 ownership。
- 对外提供稳定 `subscribe`；切换后监听器自动转发新 Session 事件，旧 Session 事件不再泄漏。
- 通过 `before/prepare/commit/rollback/after/finalize` 生命周期协调宿主 Binding。
- new/fork 在提交失败时释放目标 Session，并删除本次创建的 Conversation 产物。
- resume 失败时保留既有 Conversation 文件，只释放本次取得的目标所有权。
- dispose 等待已排队事务收敛后释放最终活动 Session。

### 2. `SessionManager setup` 到 V2 Conversation 的兼容桥

当调用方传入 `newSession.setup` 时：

- 在临时目录创建真实、持久化的 `SessionManager`。
- 执行原 setup 回调，不改变其 API 和调用语义。
- 显式写出 header 与全部 entries 的完整 JSONL 快照，覆盖旧 Store 对 user-only 写入延迟 flush 的行为。
- 调用已有 `migrateLegacySessionToV2` 导入目标 Conversation。
- 由 Greenfield Backend resume 该会话并进入同一切换事务。
- 导入或恢复失败时删除新建 V2 产物，临时 Legacy 文件始终清理。

### 3. Extension Session Binding 事务

Greenfield IM Runtime Host 新增 Session 级 Extension Binding Controller：

- 每个活动 Session 拥有独立 Event Host、Runner、Readonly Session Context 和 Action Host。
- 切换时先构建目标 Binding；若 RPC 已初始化，则复用相同 UI、shutdown 和错误处理合同，但不重复发送 `session_start`。
- 提交失败时恢复旧 Binding，并把共享 Extension Runtime 的 actions 重新绑定回旧 Session。
- 成功后释放旧 Binding时不发送 `session_shutdown`；整个 RPC 宿主最终 shutdown 时仅对当前 Binding 发送一次。
- 已具备 handler 时可发送 `session_before_switch`、`session_before_fork`、`session_switch` 和 `session_fork`。兼容性描述仍未把这些事件标记为已切换，因此依赖这些事件的 Extension 当前仍走 Legacy。

### 4. RPC 生产接线

`GREENFIELD_IM_RPC_PROFILE` 新增：

- `new_session`
- `switch_session`
- `fork`

`GreenfieldImRpcSessionAdapter` 不再缓存固定 Session/Core Assembly，而是在每次状态、消息、Turn、Memory 和 Session 操作时读取活动 Session。宿主返回的 `session` 也改为动态 getter。

未迁移的 `get_session_stats`、`export_html`、`set_session_name`、`get_fork_messages` 和 `get_last_assistant_text` 没有加入 Greenfield Profile；它们不会因同属 session capability 就被错误暴露。

## 失败与回滚合同

| 失败位置 | 活动 Session | 新产物 | 旧 Session |
| --- | --- | --- | --- |
| before 取消/失败 | 保持旧 Session | 未创建 | 保持活动 |
| create/resume/fork 失败 | 保持旧 Session | new/fork 清理 | 保持活动 |
| Binding prepare/commit/after 失败 | 恢复旧 Session 与旧 actions | new/fork 清理 | 保持活动 |
| finalize/旧 Session dispose 失败 | 保持新 Session | 保留已提交产物 | 报告提交后清理失败 |

## 测试

定向测试结果：

- `packages/coding-agent/test/runtime-core/greenfield-active-session-transition-host.test.ts`：5 个测试通过。
  - 稳定订阅迁移与成功切换顺序。
  - after 失败时活动 Session/Binding 回滚。
  - 提交后清理失败不回滚已发布的新 Session。
  - 真实 `SessionManager setup` 导入 V2 Conversation。
  - fork 绑定失败时删除新产物。
- `packages/coding-agent/test/rpc/rpc-command-dispatcher.test.ts`：6 个测试通过。
- `packages/cli-app/test/greenfield-im-rpc-adapter.test.ts`：10 个测试通过。
  - 动态 Session 身份读取。
  - new/switch/fork 委托到 Active Session Host。
  - 固定订阅与资源释放合同。
- `packages/cli-app/test/greenfield-im-runtime-host.test.ts`：11 个测试通过。
  - 真实 Conversation ownership 的 new → switch → resume 闭环。
  - Runtime Host 的活动 Session getter 随事务切换。
  - 跨会话后 `session_start/session_shutdown` 仍各发送一次。

验证命令：

- 上述 4 个定向测试文件：32 个测试全部通过。
- `packages/cli-app` `bun run typecheck`：通过。
- 根目录 `bun run check:quick`：通过。
- 根目录 `bun run check`：通过。

## 明确未修改

- 没有修改 Runtime Backend、Conversation Document、fork 内容或 ownership 算法。
- 没有把 Session Transition 实现放进 Runtime Core；它仍是 Coding Agent/CLI 产品宿主编排。
- 没有改变 Legacy RPC 会话管理行为。
- 没有把未迁移的 session 子命令加入 Greenfield Profile。
- 没有在本轮注入生产 Extension Command Host，也没有关闭 Command-only Extension 的 Legacy 回退。

## 下一步

下一阶段应完成 Extension Command Context 的剩余闭环，而不是继续扩张 Active Session Host：

1. 用本轮 Active Session Host 实现 Command Context 的 `newSession`、`switchSession`、`fork` 和 `waitForIdle`，并验证 setup 的真实迁移行为。
2. 为 `navigateTree` 建立 Greenfield History Controller 的分支导航、label 与 summary 等价适配。
3. 定义 `reload` 的资源重载范围，确保 Prompt、Skill、Extension Tool/MCP 等动态源按现有语义重绑定，而不是重建内核。
4. 补齐六个 Command Context 动作及 session before/after 事件的 Legacy/Greenfield 差分门禁后，再注入生产 Command Host，并更新 capability descriptor 关闭对应回退。
