# 158：Session Identity 资源隔离与切换静默点

## 目标

第 157 阶段已经保证最终 `AgentSession.close()` 会等待 Agent、后台 Bash、Subagent 和 MCP 静默后再释放会话锁，但 Legacy
`AgentSession` 会在同一个对象内执行 `newSession`、`switchSession` 和 `fork`。这些操作替换了 Session ID/文件，原后台任务管理器、
Subagent 协调器和 Todo 状态却仍从构造期延续，形成跨会话身份污染。

本阶段建立比最终 close 更窄的 Session Identity 切换边界：旧身份拥有的执行资源先静默，新身份再取得新的资源绑定；工作区级
Runtime、Tool、Skill、Extension 和 MCP 连接保持原实例与原功能。

## 基线结论

- `SessionNavigator` 只中止前台 Agent，并直接修改同一个 `SessionManager` 的当前身份；后台 Bash 和 Subagent 不参与切换。
- `BackgroundTaskManager` 只在 `AgentSession` 构造时创建。旧任务结束后通过当前 `sendCustomMessage()` 投递通知，因此可能把 A
  会话的完成事件写入并唤醒 B 会话。
- `SubagentCoordinator` 的 `parentSessionId` 和 `parentSessionFile` 是构造期值；切换后新建 child 仍可能引用初始父会话。
- `TodoStore` 只在 `AgentSession` 构造时恢复，切换后会继续携带旧 Todo 和 continuation 状态。
- Bash Tool 在构建时闭包捕获具体后台任务管理器，而 task/Subagent 工具已使用 getter；若简单替换 Manager，Bash 仍会写入旧实例。
- MCP Manager、Extension Runner、Skill/Prompt Loader 和 Tool Registry 由工作区 Runtime 持有，不应仅因 Session ID 变化而重启。

## 实施内容

### Identity 资源生命周期接缝

`SessionContext` 新增两个内部生命周期动作：

- `quiesceSessionIdentityResources()`：移除旧 Subagent 可见引用、关闭后台完成通知，并等待旧 Subagent dispose 与后台任务
  shutdown；任一关键资源失败会拒绝切换，不能把未静默状态伪装成成功。
- `activateSessionIdentityResources()`：在 `SessionManager` 已提交新身份后创建新的 `BackgroundTaskManager` 和
  `SubagentCoordinator`，恢复目标分支 Todo，并向宿主发布空后台任务/Subagent 快照及恢复后的 Todo 快照。

该接缝没有引入通用 Resource Registry，也没有把 RuntimeManager、MCP 或资源加载器纳入 identity scope。

### 会话切换顺序

`newSession`、`switchSession` 和 `fork` 统一经过 `replaceSessionIdentity`：

1. 先执行原有可取消 Extension before 事件；取消时不触碰任何 identity 资源；
2. 按原行为中止/清理前台 Turn，并执行旧身份 `SessionEnd`；
3. 等待旧后台 Bash 与 Subagent 静默；
4. 修改 SessionManager 的当前 ID/文件并同步 Agent sessionId；
5. 立即绑定新后台任务、Subagent 父身份和 Todo 状态；
6. 继续执行原有 setup、消息恢复、模型/Thinking 恢复及 after 事件。

若 SessionManager 身份替换同步失败，会为仍然有效的当前身份重新创建空的可用资源后再抛出错误。同文件内的
`navigateTree`/`switchBranch` 不改变 Session identity，因此不进入该流程。

### 动态工具绑定

`BashToolOptions` 在保留原 `backgroundTasks` 兼容参数的同时增加内部 `getBackgroundTasks`。Bash/Shell 每次执行时解析当前
Manager；`task_output` 和 `task_stop` 也读取同一 live getter。现有 Tool 对象、激活名单、System Prompt 和 Extension wrapper
无需重建，切换后的命令自然落入新 identity scope。

Subagent 控制工具继续使用既有 coordinator getter。新协调器以当前 Session ID/文件构造，因此 child transcript、snapshot 和
Hook turn identity 均指向新父会话。

### Todo 恢复

`restoreTodoFromSession` 现在始终替换内存状态：目标分支存在 `todo_snapshot` 时恢复最后一个快照，不存在时恢复为空列表。这样
新会话不会继承旧计划，resume/fork 则按目标分支事实恢复；恢复过程不追加新的持久化快照。

## 明确未修改

- 未改变 Tool 名称、描述、参数、执行结果或默认激活策略；
- 未重启、重建或迁移 MCP 连接，MCP 配置仍按原 prompt-entry 动态刷新；
- 未改变 Skill、Scene、Knowledge、Extension 或 Hook 的业务合同；
- 未让同文件 branch navigation 终止后台工作；
- 未改变 Session JSONL、RPC Frame、Provider 或 Runtime Backend 选择；
- 本阶段只有进程内生命周期接线，没有新增不可信 JSON/配置解析边界，因此不引入 TypeBox/Zod。

## 测试

- Coding Agent identity 集成测试：Extension 取消时保留原资源；真实后台 PID 在 `newSession` 返回前消失；旧 Subagent 按
  `abort → waitForIdle → close` 静默；新 coordinator 使用新父 ID/文件；`switchSession` 恢复目标 Todo；`fork` 再次轮换资源并
  保留分支 Todo。
- 动态 Tool 门禁：同一个 Bash/Shell Tool 对象跨 identity 保持不变，但新后台调用进入新的 Manager，证明没有通过重建 Runtime
  掩盖闭包问题。
- 回归测试：AgentSession close、Bash block-until/shutdown、Runtime close、Subagent coordinator 和 branching 共 28 项通过，
  另有 3 项需要真实 API key 的既有测试按原条件跳过。
- 真实 Vetta RPC CLI：Legacy 后台命令启动后执行 `new_session`，响应返回时 PID 已消失、源锁释放、目标锁持有、无旧任务通知
  触发额外 Provider 请求，并可在同进程继续 Turn。
- 独立安装 CLI 产物：重复 Legacy 后台 PID → `new_session` → 新会话恢复场景，验证 standalone 二进制与源码入口一致。
- `bun run check:quick` 和根目录 `bun run check` 通过。

## 结果

Legacy `AgentSession` 现在明确区分工作区 Runtime 生命周期与 Session Identity 生命周期。会话切换不再携带旧后台进程、旧
Subagent 父身份或旧 Todo，也不会为了隔离这些资源而重建 MCP、Skill、Extension 或 Tool Runtime。最终 close 与身份切换分别
拥有匹配其粒度的静默点。

## 下一步

下一阶段应审计仍留在长生命周期 Controller/Runtime 中的会话学习态，重点包括 MCP deferred 激活集合、Plugin continuation
幂等键/待执行 effect、Compaction prefire 缓存和 Todo nudge signature。应先区分“工作区配置态”与“Conversation 学习态”，只重置
后者，并用 Legacy/Greenfield 差分确认现有可观察行为；不得借此重建整个 Runtime 或改变动态能力功能。
