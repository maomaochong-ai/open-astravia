# 阶段 46：Session Work Management

## 目标与阶段粒度

本阶段一次迁移三类宿主工作状态：后台 bash、subagent 和 todo。它们在 RuntimeHost 中共同服务活动面板、订阅重放和
用户工作控制，适合作为一个实施阶段；代码合同仍拆成 Background Work 与 Todo 两个窄 Port，避免为了合并阶段而制造
万能接口。

目标是移除 RuntimeHost 对旧 `backgroundTasks`、subagent 方法和 `todoStore` 的直接依赖，同时保留所有现有功能、
快照字段、返回值和事件回放行为。

## 类型审计

现有 `SubagentInfo` 是事件投影，但旧 `SubagentSnapshot` 还包含完整 usage：input、output、cacheRead、cacheWrite 和
costTotal。若直接让列表返回 `SubagentInfo`，会静默删除宿主当前能够拿到的数据，属于功能重构。

因此新增 runtime-core 自己的：

```text
RuntimeSubagentUsageSnapshot
RuntimeSubagentSnapshot extends SubagentInfo
```

该快照保留旧列表和中断结果的全部字段，同时解除 RuntimeHost 对 coding-agent `SubagentSnapshot` 类型的依赖。

## 新增合同

```text
RuntimeSessionBackgroundWorkController
  ├─ clearFinished()
  ├─ killTask(taskId)
  ├─ readTasks()
  ├─ readSubagents()
  └─ interruptSubagent(target)

RuntimeSessionTodoController
  ├─ readItems()
  └─ clear()
```

Background Work Port 对应现有同一个活动面板：后台任务和子代理共用“清除已结束”，同时分别支持列表、终止和中断。
Todo Port 保持独立，因为其锁、持久化和 turn continuation 生命周期与后台进程不同。

## Legacy 适配

新增 `LegacyRuntimeSessionBackgroundWorkController`：

- 后台任务列表继续使用旧 Manager 生成的快照，并返回新数组；
- 用户终止继续调用 `kill(taskId, "user")`；
- 子代理列表和中断结果完整保留 usage、todoProgress、title 等字段；
- `clearFinished()` 继续先清后台 bash，再清终态 subagent，并返回两者数量之和；
- 未启用 subagent、未知 task/target 及底层异常继续由旧 Session 保持原语义。

新增 `LegacyRuntimeSessionTodoController`：

- `readItems()` 返回数组副本，item 引用语义与旧 RuntimeHost 相同；
- locked 时拒绝清空；
- 空列表不执行清空；
- 非空且未锁定时调用旧 TodoStore clear，继续触发持久化与 todo_update。

两个 Port 均由 `RuntimeHostSessionAssembly` 显式交付。

## RuntimeHost 迁移

- `clearFinishedBackgroundTasks()`、`killBackgroundTask()`、`listBackgroundTasks()`、`listSubagents()` 和
  `interruptSubagent()` 全部改由 Background Work Controller 执行。
- 未知 session 继续分别返回 `0`、`false`、`[]` 或 `undefined`。
- `clearTodos()` 保持原异步公开签名，但内部委托 Todo Controller。
- 新订阅者的 todo 全量回放改从 Todo Controller 读取，仍先发送 created，再在非空时发送 todo_update。
- RuntimeHost 已不存在 backgroundTasks、subagent 或 todoStore 的直接访问。

## 测试

新增 `session-work-management.test.ts`，固定：

- 后台任务和 subagent 列表复制；
- 用户终止原因 `user`；
- subagent 中断委托；
- 先清后台任务、再清 subagent，以及联合计数；
- 完整 subagent usage 保留；
- todo 列表复制；
- locked、empty 和可清空三类 todo 行为。

Assembly 隔离测试在同一阶段综合验证：

- todo 订阅重放只读取 Assembly Port；
- 后台任务/subagent 的列表、终止、中断、联合清理只调用 Assembly Port；
- todo 清空只调用 Assembly Port；
- 自定义 Assembly 不回退访问旧 Session 的后台和 todo 对象。

## TypeBox / Zod 判断

本阶段的快照由进程内 Session 实现产生，字段已经是类型化对象，不是新外部输入边界，因此不引入 TypeBox/Zod。
desktop IPC 发送仍复用既有 SessionEvent/调用路径；若未来允许外部进程提交后台工作快照，应在 IPC Adapter 对原始数据
校验，而不是在 Session Port 内校验自身输出。

## 明确未修改

- 没有改变后台任务启动、输出文件、通知或进程终止实现。
- 没有改变子代理并发、排队、生命周期、文件或 Hook 行为。
- 没有删除 subagent usage 或其他旧快照字段。
- 没有改变“清除已结束”联合计数和执行顺序。
- 没有改变 todo 持久化、锁来源、ID 重置或事件通知。
- 没有迁移 steering/follow-up、插件配置或 agent mode。
- 没有修改 Greenfield Backend，也没有切换生产默认 Backend。

## 下一步分析

RuntimeHost 目前只剩四处旧 Session 直接调用：steering mode、follow-up mode、插件重配置和 agent mode。下一阶段不再
逐个拆小轮次，建议作为一个“Session Runtime Configuration”阶段整体处理，但合同仍按对话输入配置与动态能力配置
区分职责。

需要固定：settings 中仅非空 mode 才更新、插件配置在 turn 边界延迟应用、失败时恢复 pending 配置、全局 agent mode
在各 Session 下一 turn 独立应用，以及 busy 时继续延迟。完成后 RuntimeHost 的在线 Session 操作应不再直接调用旧
AgentSession，剩余旧类型只存在于兼容创建和显式 Legacy Adapter 边界。

## 验证

- Work Management 与 Assembly 定向测试：2 个文件，14/14 通过。
- Runtime Core 完整测试：17 个文件，86/86 通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
