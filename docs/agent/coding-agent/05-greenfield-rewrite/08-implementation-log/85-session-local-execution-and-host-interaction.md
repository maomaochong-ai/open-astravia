# 第 85 轮：Session-local 执行层与宿主交互

## 1. 本轮目标

在不改变既有工具功能的前提下，继续收敛 Greenfield RuntimeHost Assembly 缺口：

1. 建立真实 Host Interaction Broker。
2. 让 execution mode 切换绑定 Session-local 工具执行状态。
3. 隔离每个 Session 的后台命令、任务查询工具、通知和观察事件。
4. 保留运行期动态停用、移除和同名重新注册工具的语义。
5. 不以不完整的 Subagent 实现伪造 `backgroundWorkController`。

## 2. 架构审计结论

不能把整个 Tool Registry 简单复制到 Session：

- MCP、RPC Host Tool 和其他动态工具仍需要 workspace 共享注册入口。
- Bash/Shell、sandbox 文件工具和后台任务包含 cwd、进程、权限与任务状态，必须按 Session 隔离。
- 如果全部共享，有状态任务会跨会话泄漏；如果全部复制，运行期新增和删除工具又无法传播。

因此采用两层组合：

```text
Workspace Shared Tool Catalog
  ├─ 无状态内置工具
  ├─ MCP / RPC 动态工具
  └─ 工具注册、停用、撤销与替换事实源

Session Execution Overlay
  ├─ Bash / Shell Executor
  ├─ Sandbox Read / Write / Edit / Shell
  ├─ Background Command Service
  ├─ task_output / task_stop
  └─ Host Interaction Broker
```

Session Overlay 只遮蔽当前仍属于原共享注册绑定的有状态工具。共享工具被停用或移除后，Overlay 立即停止
广告和执行；同名新定义重新注册后，Overlay 让出名称，由共享 Catalog 的新定义接管。

## 3. Host Interaction Broker

`runtime-core` 新增 `RuntimeSessionHostInteractionBroker`：

- RuntimeHost 可在 Session Assembly 注册后绑定当前宿主 UI。
- sandbox 工具只依赖稳定的 `RuntimeSessionHostInteractionContext`。
- 尚未绑定宿主时 `confirm` 返回 `false`，sandbox grant 返回 `deny`。
- 重绑定后调用读取最新 Context，不缓存旧 UI。

这保持了 fail-closed 权限语义，也避免 Tool Runtime 反向依赖 Desktop 或 Legacy Extension。

## 4. Session-local 执行覆盖层

CLI App 新增 `GreenfieldSessionExecutionRuntime`，每个 Session 独立持有：

- 前台与后台 Command Executor。
- `BackgroundCommandService`。
- 可原子替换的 Coding Tool Catalog。
- full-access / sandbox 当前模式。
- Host Interaction Broker。
- 独立 Agent Feature。

full-access 继续复用 Runtime Tools 中既有 Bash、Shell、task_output 和 task_stop 注册，描述、Schema、scope、
requires 与执行结果没有重新定义。

sandbox 通过 Coding Agent 的过渡适配器复用既有 Windows/Linux/macOS sandbox 工具构造器。适配器只把旧
Extension UI 调用收敛到 Runtime Host Interaction Port，没有重写权限、路径或命令行为。

## 5. 模式切换与原子性

`RuntimeSessionExecutionController.reconfigure()` 允许异步完成，`RuntimeHost.setExecutionMode()` 必须等待
重配置成功后才能更新公开状态。

Session Runtime 的切换顺序为：

```text
构造下一模式完整 Tool Registry
  → 成功后原子 swap Catalog 指针
  → 最后提交 mode 状态
```

构造失败不会留下半套工具，也不会提前改变 RuntimeHost 的 `executionMode`。

## 6. 动态工具兼容

Session Overlay 在创建时记录共享 Catalog 中原始工具的 `CapabilityBinding`，模型调用与工具执行都实时
比较共享状态：

- `deactivate`：下一次模型调用不再广告；已广告工具执行时返回 `coding_tool_deactivated`。
- `unregister`：Overlay 不再广告或执行。
- `revoke`：保持撤销错误语义。
- 同名重新注册：新 revision 不再由 Overlay 遮蔽，共享新定义在下一次模型调用生效。

因此本轮没有把“会话隔离”实现成静态快照，MCP 和其他动态注册机制仍保持共享、实时。

## 7. 后台任务观察与通知

每个 Session 的 Background Command Service：

- 任务 id、list、stop、output cursor 和清理状态互不共享。
- 每次任务变化发布 `background_tasks_update` Session Observation。
- terminal notification 追加为 model-visible `task-notification` Context Record。

后台任务可能在 Turn 之间结束，因此 `RuntimeSessionObservationEnvelope.turnId` 改为可选；Turn 内观察仍继续
携带具体 `turnId`。

## 8. Assembly 完整性

真实 Greenfield CLI Composition 现在交付：

- `hostInteraction`
- `executionController`
- `todoController`
- `configurationController`

完整性评估只剩：

- `backgroundWorkController`

虽然 Session-local Background Command 已存在，本轮仍不暴露不完整 Controller，因为该合同同时包含
Subagent 查询、中断和清理，而 Greenfield Subagent Runtime 尚未交付。

## 9. 测试与验证

新增或扩展测试覆盖：

1. Broker 未绑定 fail-closed、绑定与重绑定。
2. execution mode 的 Session-local 切换和真实 busy state。
3. RuntimeHost 等待异步 reconfigure 后才提交状态。
4. 两个 Session 的后台任务、观察和通知互不泄漏。
5. 动态停用同时影响下一次广告和已广告工具执行。
6. 同名工具新 revision 由共享 Catalog 接管。
7. 真实 Composition 的 Assembly 缺口只剩 `backgroundWorkController`。
8. 既有 Greenfield prompt、读工具、MCP、知识库、Plugin、压缩与持久化组合测试继续通过。
9. Desktop 独立 `tsconfig` 显式映射 Greenfield 源码入口，避免 wildcard 回退到过期 `dist` 声明。

## 10. TypeBox / Zod 判断

本轮没有新增外部 JSON、IPC 或持久化输入。执行模式、Capability Binding、Observation 和 Host Interaction
均为进程内强类型合同，因此没有引入 TypeBox 或 Zod。既有 Tool input Schema 继续使用原实现，不做功能改写。

## 11. 明确未修改

- 没有重写 Bash、Shell、Read、Write、Edit、task_output 或 task_stop 的产品行为。
- 没有把 MCP 或 RPC 动态工具变成 Session 静态副本。
- 没有让 sandbox 在宿主未绑定时自动授权。
- 没有暴露缺少 Subagent 语义的 `backgroundWorkController`。
- 没有切换 Desktop 生产 Backend。

## 12. 下一步

下一阶段应作为一个完整纵向切片实施：

1. 建立 Greenfield Session-local Subagent Runtime，明确父子 Session ownership、usage、事件和释放合同。
2. 将 Background Command 与 Subagent 合成为真实 `backgroundWorkController`。
3. 补齐多会话隔离、终止、清理、恢复与 Desktop Candidate Assembly 集成测试。
4. Assembly 真实 `ready` 后，再评估 Desktop 显式 opt-in；不得提前删除 Legacy fallback。
