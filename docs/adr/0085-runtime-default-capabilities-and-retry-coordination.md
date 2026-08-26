# Runtime 显式默认能力与重试协调

## 状态

Accepted

## 背景

Runtime Core 已经拥有 Agent Definition、Session、Turn、不可变 Snapshot、失败合同和 Observation，但创建简单 Agent
仍需重复填写空 Feature、透传 Context Strategy、Tool Policy 与 token 预算。与此同时，自动重试的通用状态机位于
Coding Agent，SDK、CLI 和 RuntimeHost 入口依赖产品类来处理并发 owner、退避、取消与 `Retry-After`。这使其它产品
无法复用，也让 Coding Agent 承担了 Runtime 机制。

Runtime 若只提供接口而不提供可执行的产品无关默认实现，产品层会被迫重新实现 Runtime；若把 Coding 错误分类、设置
存储或产品事件整体下沉，又会违反 ADR-0077 的所有权边界。

## 决策

- Runtime Core 提供显式 `createDefaultRuntimeCapabilityDefinition()`。它返回普通
  `RuntimeCapabilityDefinition`，不改变 `defineRuntimeAgent()`，不建立隐藏的默认 Agent 或第二条执行路径。
- 默认能力采用透传 Context、拒绝 Tool 的安全策略、空 Prompt/Feature/Observer 和保守 token 预算。调用方通过普通能力
  字段覆盖；稳定 Prompt 缓存前缀继续由 ADR-0081 的默认 Frame 编译规则产生。
- Runtime Core 以 Strategy + Coordinator 提供自动重试。Strategy 读取动态设置和结构化 `RuntimeFailure`，Coordinator
  独占并发 owner、attempt、取消、延迟和终止事件。
- RuntimeHost 的失败事件延迟与 Session 装饰器属于 Runtime Core；产品只注入设置来源和失败投影，不复制事件状态机。
- 自动重试默认关闭。`Retry-After` 是最小等待时间；若超过调用方配置的最大延迟，停止自动重试而不是提前请求。
- 第一阶段保持现有行为：每次 retry 是新的 Runtime Turn，并重新取得 Turn Snapshot。若未来需要让一组尝试固定首次
  Snapshot，必须单独修改公共合同并记录 ADR。
- 重试的关键生命周期和停止原因进入 Runtime Observation。payload 只包含 attempt、delay、失败 code/origin 与枚举原因，
  不包含错误正文、Prompt、消息、Tool 参数/结果、响应正文、凭证或 stack。Observation 失败不得影响重试结果。
- Coding Agent 现有重试类型、工厂和事件保持兼容，但实现退化为 Runtime 合同的薄别名/适配，不保留平行状态机。

## 被拒绝方案

### 在 `defineRuntimeAgent()` 内隐式注入默认值

这会让低层调用者无法判断实际能力来源，并形成难以覆盖和观测的特殊路径。显式工厂既开箱即用，也保持普通能力合同。

### 只把重试接口放进 Runtime

产品仍需各自实现并发、取消、退避和事件顺序，无法消除重复事实源。

### 把 Coding Agent 设置和错误分类一起搬入 Runtime

设置存储、历史错误兼容和产品事件属于 Coding Agent；Runtime 只接受已经收窄的结构化失败与产品无关设置。

### 提供任意 `next()` 重试中间件

万能 Middleware 会模糊 Turn、Snapshot 和错误所有权。显式 Coordinator 与 Session Decorator 能表达实际变化点且更易测试。

## 后果

- 简单自定义 Agent 可以少量代码获得安全默认能力，并按普通字段逐项覆盖。
- Coding Agent、其它产品和独立模块共享同一重试实现，日志可统一进入 Runtime Observation Hub。
- Runtime 新增公共 API，需要 Runtime 合同测试以及 Coding Agent、CLI、Desktop 消费路径的兼容测试。
- 自动重试仍是显式选择，不会改变未配置 Agent 的网络行为或成本。
