# 第 217 阶段：SDK 活动 Session 所有权与 Runtime 能力闭环

## 阶段目标

本阶段把 SDK 从“一个固定 Runtime Session 的门面”推进为“稳定 SDK 对象加可替换活动 Session”，同时保持
固定 Session Adapter 的职责不变：

1. 复用既有 `CodingAgentGreenfieldActiveSessionHost`，不实现第二套身份切换事务；
2. SDK 对象在 `newSession`、`switchSession`、`fork` 前后保持同一引用；
3. Composition 生命周期长于单个 Runtime Session；
4. Extension、Session 资源、事件订阅和 Bash 状态随身份事务切换；
5. 接通兼容清单中剩余的 18 个 `runtime-capability` 成员；
6. 不切换包根公开 `createAgentSession`，不删除旧实现，不处理产品对象泄漏。

## 实施前问题

### 固定 Session 不能承担身份迁移

`GreenfieldSdkSessionAdapter` 的 Runtime Port 指向单个 Session。直接向它加入 `newSession`、`switchSession`、
`fork` 会迫使该对象同时拥有 Session、Composition、资源重绑和失败回滚，再次形成没有边界的会话大对象。

### 原 SDK Factory 的生命周期过短

原 `createGreenfieldSdkSession` 把 Composition、Runtime Session 和产品资源一起绑定到固定门面。它可以正确
关闭单个 Session，但无法在保持 SDK 对象和 Composition 不变的情况下替换当前 Session。

### 产品资源和直接 Bash 具有身份状态

Extension Runner、Session 私有资源、正在执行的直接 Bash 和流式期间暂存的 Bash 结果都属于具体 Session。
只替换 Runtime Session 会造成旧 Runner、旧消息或运行中的命令跨身份泄漏。

## 架构决策

### 稳定外观与固定叶子分离

新增 `GreenfieldSdkActiveSessionAdapter`，它在固定 `GreenfieldSdkSessionAdapter` 之上只叠加活动会话命令。
固定 Adapter 仍然不知道如何创建、恢复或替换 Session。运行时读取通过活动宿主实时解析当前 Session：

```text
GreenfieldSdkActiveSessionAdapter
  -> Greenfield SDK Active Capability Port
  -> CodingAgentGreenfieldActiveSessionHost
  -> current GreenfieldRuntimeSession
```

### 复用唯一身份事务

SDK Factory 创建并持有现有 `CodingAgentGreenfieldActiveSessionHost`。new/resume/fork 继续使用其既有：

- 串行准入；
- 活动 Turn 中断；
- SessionEnd/SessionStart Hook；
- prepare/commit/rollback/after；
- 提交后旧 Session 清理；
- 清理失败重试。

SDK 没有复制这些状态机。

### Session 资源进入同一事务

`initializeSession` 现在区分 `initial` 与 `transition`。目标 Session 的资源在 prepare 阶段创建：

- commit 后成为当前资源；
- rollback 时释放目标资源并恢复旧资源；
- finalize 时释放旧资源；
- SDK close 只释放当前资源一次。

Extension 适配器使用相同事务迁移当前 Event Host，并保留 before-switch、before-fork、session-switch、
session-fork 和 runtime action 回绑行为。

### 直接 Bash 按 Session 隔离

新增 SDK Bash 适配器，继续复用原 Bash 执行器和消息格式：

- 支持输出流、命令前缀、自定义远程 `operations` 和 `excludeFromContext`；
- 运行状态记录所属 Session；
- 流式期间的结果按 Session ID 暂存，agent_end 或身份切换前写入对应上下文；
- 身份切换会先 abort 并等待当前直接 Bash，再释放旧 Session；
- 不把 Bash 状态放入 Runtime Kernel。

### TypeBox/Zod 决策

本阶段新增的是进程内对象引用、生命周期和命令 Port，没有新增不可信 JSON、配置或协议载荷，因此没有引入
TypeBox 或 Zod。现有外部数据校验边界保持不变。

## 实施记录

### SDK 合同和门面

- 增加 Active Session、树导航、Bash、setup 和身份切换中立合同；
- 增加稳定 Active Session Adapter；
- 增加活动 Session Runtime Binding，状态、消息、模型和观察订阅实时读取当前 Session；
- 固定 Session Adapter 未加入身份迁移方法。

### SDK Composition Root

- Composition 改为覆盖整个 SDK 活动会话生命周期；
- 创建 Active Session Host，并使用文件或内存 Session Catalog；
- capability host 的 `readSession` 改为动态解析当前 Session；
- 自定义工具重配置写入当前 Session ID；
- close 顺序调整为 capability、active host、当前 Session 资源、Composition、宿主资源。

### Runtime 能力

已接入：

- `newSession`、`switchSession`、`fork`、`exportForkToNewFile`；
- `getSessionBranch`、`navigateTree`、`switchBranch`、`appendBranchSummary`、`deleteMessage`、
  `replaceLastUserMessage`、`getUserMessagesForForking`、`abortBranchSummary`；
- `sendCustomMessage`、`sendUserMessage`；
- `executeBash`、`abortBash`、`isBashRunning`、`hasPendingBashMessages`。

兼容清单现在要求全部 `runtime-capability` 成员必须为 `wired`，未来增加成员而未接线会使测试失败。

## 测试与验证

测试覆盖：

- 同一 SDK 对象跨 new/switch/fork 保持稳定；
- 执行观察订阅跨身份切换继续有效；
- 无效切换回滚后旧 Session 仍可执行 Prompt；
- Session 资源在成功切换和失败回滚时各释放一次；
- Extension 绑定和 Legacy `newSession.setup` 随切换工作；
- 树导航返回编辑文本、摘要和取消状态；
- Bash 输出持久化、流式暂存、身份切换前 flush 和 abort/wait；
- 全部 Runtime capability 的兼容接线状态。

验证结果：

- 定向测试：7 个文件、54 项测试通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查和架构门禁；
- Greenfield 产品 Core 依赖预算保持不变：adapter 84、composition 5、RPC 4、SDK 2。

## 刻意保留的边界

- 包根公开 `createAgentSession` 仍返回旧 `AgentSession`，本阶段没有切换公共工厂；
- 17 个产品适配成员和 8 个 Legacy 具体对象仍保持 `not-wired`；
- Greenfield 历史持久化是异步合同，公共旧 SDK 中若干同步历史写方法的最终签名兼容需要在公共工厂切换阶段
  明确解决，不能用后台写入伪造同步成功；
- 之前的方案文档不更新，本文件只记录本阶段实际实施过程。

## 阶段结论

SDK Greenfield 路径现在拥有稳定外观和明确的活动 Session 所有权，身份迁移不再污染固定 Session Adapter。
所有 Runtime capability 已有真实端口和行为实现，剩余工作集中为产品能力适配、Legacy 具体对象退出和公共工厂
切换。
