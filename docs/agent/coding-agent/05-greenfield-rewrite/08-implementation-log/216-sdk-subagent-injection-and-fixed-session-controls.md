# 第 216 阶段：SDK Subagent 注入与固定 Session 控制闭合

## 阶段目标

本阶段只恢复现有 SDK 的 Subagent 扩展和固定 Session 控制能力，不重构 Subagent 功能：

1. 修正 Greenfield `enableSubagents` 默认值与旧 SDK 不一致的问题；
2. 接入公开 SDK 已有的 `subagentTypeRegistry` 和 `subagentSessionFactory`；
3. 保持 Registry 在 Session 运行期间可动态注册或替换类型；
4. 将 `listSubagents`、`interruptSubagent`、`clearFinishedSubagents` 接入固定 Session 门面；
5. 不暴露具体 coordinator、Legacy `AgentSession` 或 `session.subagents`；
6. 保留旧自定义类型的内置工具、MCP 继承、Todo、上下文 fork、deny prefix 和显式 Child Factory 行为。

本阶段不切换公开 `createAgentSession` 工厂，也不修改模型执行、工具协议、Subagent 调度或取消语义。

## 实施前问题

### 1. 默认启用语义发生了功能变化

旧 SDK 明确把 `enableSubagents` 定义为 fail-closed，只有 `true` 才创建 Registry 和 Child Factory。
Greenfield Session Context 却使用 `enableSubagents !== false`，导致 `undefined` 会启用 Subagent。这不是架构
重构允许发生的功能变化。

### 2. SDK 的两个动态扩展点被拒绝

兼容清单把 `subagentTypeRegistry` 和 `subagentSessionFactory` 标记为 `not-wired`，SDK Host 会拒绝调用。
直接把 Legacy 类型传入 Runtime 又会破坏中立内核边界。

### 3. 固定 Session 门面缺少控制方法

Runtime 已有中立的 Subagent snapshot、读取和中断能力，但固定 SDK Session 没有暴露旧接口中的：

- `listSubagents()`；
- `interruptSubagent(target)`；
- `clearFinishedSubagents()`。

原有 `backgroundWorkController.clearFinished()` 同时清理后台命令和 Subagent，不能用来实现只清理 Subagent
的旧接口，否则会产生额外功能副作用。

## 架构决策

### 1. Runtime 只接收中立 Registry 和 Child Factory

Composition 增加以下中立注入点：

- `SubagentTypeRegistryLike<GreenfieldSubagentProfile>`；
- `GreenfieldSubagentChildFactory`；
- `GreenfieldSubagentChildFactoryContext`。

Runtime Subagent 不引用 Coding Agent 的 Legacy Registry、Session Factory、ModelRegistry 或 AgentSession。
具体适配只存在于 SDK Host。

### 2. Registry 是实时视图，不是快照

SDK Host 使用 live adapter，在每次 `get`、`list`、`ids` 和工具描述读取时委托给原 Registry：

- Session 创建后注册的新类型可被后续 spawn 立即发现；
- upsert 后的新定义用于后续 Child；
- 已经运行的 Child 不被重建或替换；
- 不因单个类型变化重建整个 Runtime snapshot。

这符合运行时工具、提示词和 Skill 可变化的总体设计，不把动态能力错误冻结在 Session 创建时。

### 3. 自定义 Registry 与自定义 Factory 独立

- 只传自定义 Registry：继续使用默认 Greenfield Child Composition；
- 只传自定义 Factory：使用旧默认 explorer/workflow Registry 的 live adapter；
- 两者都传：类型解析与 Child 创建都使用调用方实现；
- 两者都不传：继续使用纯 Greenfield 默认 Registry 和 Child Composition。

自定义类型的 `createBuiltinTools(cwd)` 在 Child 创建时求值，并转换成 Session 私有 Runtime Tool 注册；
工具仍保留 input schema、scope、requires、agent mode、category、update、phase 和 signal 调用合同。

### 4. Legacy Child 只允许出现在 SDK Host 边缘

显式 `subagentSessionFactory` 可以继续创建旧 Child，这是公开 SDK 的既有扩展能力。适配器负责：

- 构造旧 `SubagentParentContext`；
- 注入实时 model、thinking level、ModelRegistry、父 Session 身份和 fork context；
- 将父 MCP Runtime Tool 反向适配为旧 AgentTool；
- 将旧 Child Handle 收窄为 Runtime `SubagentChildHandle`；
- 释放时优先等待旧 `close()`，没有 `close()` 时才调用 `dispose()`。

Legacy 对象不会进入 Runtime Core，也不会从固定 SDK Session 暴露。

### 5. 精确区分两种清理命令

`GreenfieldBackgroundWorkController` 新增只清理 Subagent 的窄命令。原 `clearFinished()` 仍保持“后台命令加
Subagent”的合并语义；SDK 的 `clearFinishedSubagents()` 只调用窄命令，不会误清后台 bash 任务。

### 6. TypeBox 使用范围

本阶段没有新增需要解析的不可信配置或协议，因此没有引入 Zod，也没有为 Registry 重复建立运行时 schema。
仅在把中立 MCP Runtime Tool 反向适配成旧 AgentTool 时复用 TypeBox schema，因为 AgentTool 的既有合同要求
TypeBox `parameters`。实际工具参数仍由既有工具执行边界校验。

## 实施记录

### Composition 与 Subagent Runtime

- `enableSubagents` 改为仅 `=== true` 时启用，恢复旧 SDK 的 fail-closed 默认值；
- `GreenfieldSubagentProfile` 增加 Session 私有 Runtime Tool 工厂和 deny prefix 元数据；
- `GreenfieldSubagentRuntime` 支持注入中立 Registry，不再强制创建固定 Registry；
- Subagent Session Assembly 支持注入 Child Factory，并保留默认 Greenfield Child 路径；
- 自定义类型工具通过 `sessionRuntimeTools` 注入 Child Session，并加入该 Child 的显式激活；
- deny prefix 同时作用于自定义内置工具和继承的父 MCP 工具；
- Todo 继续按类型 Profile 创建和激活；
- Child Composition 仍显式设置 `enableSubagents: false`，保持单层委派。

### SDK Host 适配

- 新增 SDK Subagent anti-corruption adapter；
- live 映射旧 Registry，而不是复制注册表内容；
- 接入旧显式 Child Factory 的 create/reopen 和完整 Parent Context；
- 适配继承 MCP Tool 的 schema、执行更新、phase 和 signal；
- 恢复 `subagentTypeRegistry`、`subagentSessionFactory` 的兼容准入状态。

### 固定 Session 控制

- SDK Capability Port 增加 Subagent snapshot 读取、中断和精确清理；
- Capability Host 从 Runtime Host Assembly 的中立 Background Work Controller 读取能力；
- SDK Session Adapter 暴露旧方法名；
- `session.subagents` 继续保持 `not-wired`，具体 coordinator 不对外暴露；
- 禁用 Subagent 时读取返回空数组，中断返回 `undefined`，清理返回 `0`。

## 测试与验证

新增或更新的测试覆盖：

- `enableSubagents` 省略时不注册 `spawn_agent`；
- 注入 Registry 在 Session 创建后注册类型，后续 spawn 可立即发现；
- 注入 Child Factory 接收类型、请求和 fork context；
- 只注入 Registry 时，自定义类型工具进入默认 Greenfield Child 的 Session 私有工具面；
- 旧自定义工具保留 input、update、phase 和 signal；
- 旧显式 Factory 收到完整 Parent Context、ModelRegistry、父 MCP Tool 和 reopen 请求；
- Child Handle 释放优先等待 `close()`；
- 固定 Session 转发 list、interrupt 和 clear，并且不暴露 `subagents`；
- 精确 Subagent 清理不会调用后台命令清理；
- SDK 兼容清单把两个创建参数和三个固定 Session 方法标记为 `wired`。

验证结果：

- Coding Agent 定向测试：6 个文件、28 项测试通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部架构门禁。

## 刻意保留的边界

- `runtime-subagents` 的 Factory 合同允许 `AbortSignal`，但当前 Coordinator 没有把 Tool 调用信号传入
  Factory；本阶段只透传 Coordinator 提供的信号，没有擅自改变取消行为；
- 不暴露具体 `session.subagents`；
- 不切换公开 SDK 工厂；
- 不修改旧 Subagent 状态机、并发限制、通知、恢复或持久化功能；
- 不更新此前的方案文档，本文件仅记录本阶段实际实施过程。

## 阶段结论

第 216 阶段闭合了 SDK Subagent 的动态 Registry、显式 Child Factory 和固定 Session 控制方法。动态产品
扩展停留在 SDK Host，Runtime 只消费中立合同；默认启用语义恢复为旧功能，精确清理也不会影响后台命令。
公开 SDK 的 Subagent 功能得到保留，但具体 Legacy Session 和 coordinator 没有重新泄漏进 Greenfield 内核。
