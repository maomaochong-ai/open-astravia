# 第 84 轮：Session-local 配置与工作控制边界

## 1. 本轮目标

继续收敛第 83 轮发现的 Greenfield Desktop 外围能力缺口，但不以空实现换取 Assembly `ready`：

1. 允许外围控制器在 Kernel Session 创建或恢复后再构造。
2. 让 steering、follow-up、agent mode 和 Plugin 配置共享 Session-local 事实源。
3. 补齐 Runtime Background Command Service 的宿主查询与清理能力。
4. 保留 Host Interaction、sandbox execution 和跨会话工作隔离门禁。

## 2. 审计结论

五类缺口的成熟度不同：

- Todo 已由 `CodingAgentTodoRuntime` 真实实现并持久化。
- steering/follow-up 已有 Kernel 原生命令。
- agent mode 和 Plugin 配置过去从只读 `sessionOptions` 或外部 Source 读取，缺少统一可变事实源。
- Background Command Service 有 spawn/get/stop，但没有 list/clearFinished。
- Tool Runtime 和 Background Service 当前按 workspace composition 共享，不能直接当作 Session Controller。
- sandbox/full-access 切换仍依赖 Legacy custom tools，Greenfield 没有等价的动态 Executor/Profile 重配置。
- Greenfield Desktop Subagent Runtime 尚未形成可交付控制面。

因此本轮只接入能够保持真实语义的能力。

## 3. Session 创建后外围工厂

`GreenfieldRuntimeResources` 新增：

```ts
createSessionPeripherals(session)
```

Factory 的时序变为：

```text
createResources()
  → 创建/恢复 Kernel AgentSession
  → createSessionPeripherals(session)
  → 组装 GreenfieldRuntimeAssembly
```

外围工厂返回的控制器优先于预创建控制器。这样配置和执行控制器可以绑定真实 Session，而不需要把
Kernel Session 泄漏到上层资源加载阶段。

## 4. Session-local 动态配置

CLI Composition 新增 `GreenfieldSessionConfigurationState`：

- `readAgentMode()` 为 Prompt 和 Plugin Tool Activation 提供当前值。
- `readAgentPlugins()` 在宿主没有覆盖时继续读取原动态 Source。
- `reconfigureAgentPlugins()` 建立 Session-local 覆盖；显式传入 `undefined` 同样是有效覆盖。
- `setSteeringMode()` 和 `setFollowUpMode()` 直接调用 Kernel Session。
- `setAgentMode()` 只更新当前 Session 的事实源，下一次模型调用读取。

Prompt Runtime、Plugin Run Orchestrator、Plugin Tool Runtime 和 Model Call Frame Composer 现在共享该状态，
不再分别闭包初始 `sessionOptions.agentMode` 或 Plugin Source。

真实 Greenfield Composition 因此已交付：

- `todoController`
- `configurationController`

Assembly 剩余缺口收敛为：

- `hostInteraction`
- `executionController`
- `backgroundWorkController`

## 5. Background Command 控制边界

`BackgroundCommandService` 新增：

- `list()`：返回复制后的全部任务快照。
- `clearFinished()`：只移除 terminal task，并发布 `tasks_cleared`。

CLI App 新增 `GreenfieldBackgroundWorkController` 适配器：

- 读取任务时复制快照。
- 用户终止映射为 `stop(taskId, "user")`。
- 清理任务和可选 Subagent Runtime 的 terminal 项。
- 保留完整 Subagent usage 投影。

该适配器本轮没有接入真实 Composition。原因是现有 Background Service 为 workspace 共享对象，任务快照
没有 Session ownership；直接接入会让一个会话读取或清理另一个会话的后台任务。这属于功能错误，不是
可以接受的临时 fallback。

## 6. 行为门禁

新增和扩展测试验证：

1. Background Service：
   - list 返回快照。
   - clearFinished 不删除 running task。
   - 清理后发布事件。
2. Session Peripherals：
   - queue mode 命令绑定 Kernel Session。
   - agent mode 和 Plugin override 为 Session-local。
   - Background Controller 保留 stop reason、复制投影并聚合清理数。
3. 真实 Greenfield Composition：
   - Todo 与 Configuration Port 已存在。
   - steering/follow-up 更新真实 Kernel state。
   - 完整性门禁仍明确报告三个剩余缺口。

## 7. TypeBox / Zod 判断

本轮新增内容都是受信任进程内 Port、状态与任务快照，没有新增 JSON/IPC/持久化格式，因此没有引入
TypeBox 或 Zod。既有 Todo 持久化仍继续使用 TypeBox 校验。

## 8. 明确未修改

- 没有把 workspace 共享 Background Service 冒充 Session-local Controller。
- 没有为 Subagent 返回“已支持”的虚假声明。
- 没有以恒定允许策略实现 Host Interaction 或 sandbox。
- 没有实现不完整的 execution mode 切换。
- Desktop 生产 Backend 仍是 Legacy，`interactiveResume` 仍为 `false`。

## 9. 下一步

下一阶段应集中解决剩余三个相互关联的缺口：

1. 给 Background Command 建立 Session ownership，使 spawn/list/clear/stop 全部按 Session 隔离，并接入真实
   Greenfield Subagent Runtime。
2. 建立 Host Interaction Broker，并让 Greenfield Tool Policy/sandbox permission 实际消费当前绑定。
3. 将 execution mode 连接到 Session-local Command Executor 与 Tool Profile 重编译，保证 Turn lease 稳定。
4. 三者通过 Legacy/Greenfield 共用行为合同后，候选 Assembly 才允许变为 `ready`。
