# RuntimeHost 是 Agent 与 Conversation 的唯一宿主

## 状态

Accepted

## 背景

ADR-0079 建立了产品无关的多主 Agent Definition Registry，初始实现同时公开 `RuntimeAgentHost` 与
`RuntimeHost`。前者持有 Agent Registry、Instance、Session 和 Snapshot，后者持有 Conversation Session、Queue、
History 与宿主 Port。Coding Agent 通过一次性 Session assembly request 在两个 Host 之间交接产品资源，并在
continuation 和关闭时同步两套 Session identity 与生命周期。

这套结构虽然接通了 Coding Agent，却形成了两个顶层 owner：应用必须决定创建顺序、桥接方式和关闭顺序；产品初始化、
Snapshot 编译与 Kernel Session 注册也不属于同一失败回滚事务。`RuntimeHostSessionBackend` 又因名称相近而容易被误解为
第三个 Host，掩盖了它实际承担的平台持久化与 Session Port 边界。

## 决策

- `RuntimeHost` 是进程或应用作用域内唯一的 Runtime 生命周期根；它默认创建并公开 `host.agents`。
- `RuntimeAgentRuntime` 是 `host.agents` 的模块化控制面，继续独立拥有 Registry、Definition revision、Instance、Agent
  Session 与 Snapshot 规则。它可以脱离应用单测或单独接 Observation，但不再以第二个 Host 的公共概念存在。
- `RuntimeAgentInstanceDefinition.prepareSession()` 返回未提交的 `RuntimeAgentSessionPlan`。Runtime Core 先编译唯一
  `RuntimeSnapshotProvider`，再调用 Plan activation 接入产品 `RuntimeResources`；任一步失败都由同一 Plan/Session
  生命周期回滚。
- `RuntimeHost.createSessionBackend()` 在 Host 构造期间获得同一个 Agent 控制面和根 Observation Publisher。由该 factory
  创建的 Backend 生命周期归 Host；直接注入的 `sessionBackend` 仍视为外部所有，两者互斥。
- `RuntimeHostSessionBackend` 作为平台持久化格式与完整 Session Port 的工厂继续保留。它是必要的端口，不持有第二套
  RuntimeHost 状态。路由 Backend 的共享资源释放必须由组合根显式提供，路由器不猜测所有权。
- `CatalogRoutedRuntimeHostSessionBackend` 按持久化格式归属路由，workspace Backend Pool 按产品 Composition scope
  复用资源，`agentBackends` 按 Agent/revision 准入；三者选择维度、key 与生命周期不同，不合并成万能 Router。
- RuntimeHost 内置 `agentBackends` admission registry，弥合动态 Definition 与固定 Backend 之间的边界。Definition
  Registry 仍只回答“Agent 是什么”，admission registry 只回答“当前 Host 用哪个 Backend 接受该 Agent 的新会话”。
  每次 Backend 发布产生不可变 generation；replace/retire/remove 立即阻止旧代接受新会话，已有 Session 持有 lease，
  最后一个 Session 成功释放后才回收旧 Backend。异构 Agent 可用 `installAgent()` 事务发布 Definition 与 Backend；共享
  通用 Backend 的 Agent 仍只需动态发布 Definition，不强制建立冗余 route。
- 直接注入 RuntimeHost 的 `RuntimeObservationPort` 归 Host 所有；共享观测树应注入 Publisher。Host 关闭时依次释放
  Conversation Sessions、拥有的 Backend、Agent 控制面、Publisher 队列和直接拥有的根 Port。Session/Backend/Agent
  控制面清理失败发布 `runtime.host.lifecycle` 安全记录；具体日志、Trace、Metrics 或 UI 投影仍由 Adapter 决定。
- Coding Agent 的 production Definition 在 Instance 创建时获得显式、可校验的 Session Plan 工厂；Session
  configuration 只传本次 Session 数据与 Runtime resource context，不再传 WeakSet 标记的一次性桥接请求。
- Agent Definition revision 仍只影响新 Instance；已有 Instance、Session、在途 Turn 和 Snapshot lease 不自动改变。
  显式 rollout 继续从下一 Turn 原子切换，并保持 Extension topology 约束。

## 被拒绝方案

### 仅把两个 Host 重命名或互相包装

这不会消除两套 Session Map、identity 同步和关闭责任，只会隐藏耦合。

### 删除 RuntimeHostSessionBackend，把 Coding Agent 直接写进 RuntimeHost

这会让 Runtime Core 依赖 Coding Prompt、Tool、MCP、文件持久化和 Node 平台实现，违反 ADR-0077 的产品与平台边界。

### 让产品直接提供已编译 Snapshot Provider

这会重新产生多个能力 generation，无法保证同一 Turn 的 Prompt、Tool、MCP 与模型来自同一个 Snapshot。

### 保留一次性请求作为通用 bridge

它依赖 `unknown` Session configuration 和消费次数约定，不能表达正常的 Definition/Instance 生命周期，也让产品装配失败
跨越两个 owner。显式 Instance Plan 工厂能在不引入业务字段的前提下消除该协议。

## 后果

- Desktop、未来服务宿主和完整 CLI Host 只需管理一个 RuntimeHost；关闭与根 Observation 生命周期可统一。
- 公共 `CodingAgentHost` 仅作为 SDK 兼容的隔离 Coding Agent Session 所有权组存在。它不公开 Registry，也不能安装
  平级主 Agent；每个成员可因不同 cwd、Storage、Tool/MCP/Extension Source 与模型资源而拥有局部 RuntimeHost。
  多主 Agent 应使用应用级 RuntimeHost，而不是扩展这个产品便利 API。
- 简单 Agent 仍可只返回 Session Definition；复杂 Agent 使用 Plan activation 接入完整产品资源，不需要另一套基座。
- `RuntimeAgentHost`、`CodingAgentRuntimeAgentSessionAssemblyRequest` 和
  `CodingAgentRuntimeHostSessionBackend` 公共命名被移除，调用方需迁移到 `RuntimeHost.agents`、
  `RuntimeAgentRuntime` 与 Composition 的唯一 `runtimeHostBackend`。
- 直接使用 Coding Agent Composition 的 SDK/CLI 兼容入口可拥有独立 `RuntimeAgentRuntime` 模块；它们不是应用级第二
  RuntimeHost，未来接入完整 RuntimeHost 时无需改变 Definition 合同。
- Session Backend factory 是同步组合边界；需要异步建立的工作区 Composition 应在 Backend 内按 scope 懒加载，并由
  Backend 的显式 `dispose()` 统一释放。
- RuntimeHost 关闭 admission 后等待在途 Session 创建，Session 释放失败保留索引和 Backend lease；再次 `close()` 从失败
  阶段重试，不能先清空所有权再报告错误。动态 admission 生命周期通过 `runtime.host.agent-backend` 安全 Observation 汇入
  同一个 Host Publisher，具体日志、Metrics、Trace event 或 UI 仍由上层 Adapter 决定。
