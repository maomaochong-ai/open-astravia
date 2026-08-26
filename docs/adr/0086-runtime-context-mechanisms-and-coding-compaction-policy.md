# Runtime Context 机制与 Coding 压缩策略边界

## 状态

Accepted

## 背景

Runtime Core 已经通过 `ContextStrategy`、`ManualContextCompactionRuntime`、`ContextCompactionCommitter` 和 Session
Context Controller 统一编排 Context 准备、取消、持久化提交与 continuation 事务。Coding Agent 的默认 Context Runtime
同时实现了这些合同，但还混合拥有 token usage、连续失败熔断、自动/手动摘要算法、Coding 摘要格式、Memory、Hook、
Extension、图片错误恢复和模型调用投影。

将整个 Coding 实现下沉会让 Runtime 理解 Coding 摘要和扩展语义；只保留现状又会使其它 Agent 重复实现 usage 状态与
失败熔断，并让 Coding 的单一类继续承担多个独立职责。

## 决策

- Runtime 现有 Context Strategy、Committer 和 Session Controller 是唯一通用编排边界，不新增第二套压缩引擎或通用
  `next()` Middleware。
- Runtime Core 提供 `RuntimeContextUsageTracker`。它拥有 document/assistant/provider composition 三类 usage 更新规则，
  但 Conversation Document 如何投影和估算 token 由调用方注入。
- Runtime Core 提供可注入时钟的 `ConsecutiveFailureCircuitBreaker`，不解释失败领域或恢复动作。
- Coding Agent 保留阈值、overflow、keep-tail、摘要生成、记录格式、Memory continuation、Hook、Extension、图片恢复与
  Prefire 策略，并按自动策略、手动策略、提交后生命周期和记录工厂拆分，由 Session-local facade 组合。
- Compaction Settings、Extension generation 和 Context transform generation 继续在 Turn admission 捕获；同一 Turn 不读取
  后续发布的新配置。
- Prefire 后台成功、失败和取消改用 Coding 领域 Observation。payload 只包含 phase、token 计数和安全失败分类，不包含
  摘要、消息、凭证、错误正文或 stack；Observer/日志失败不改变 best-effort prefire 或主压缩流程。

## 被拒绝方案

### 把 Coding Context Runtime 整体迁入 Runtime Core

会反转 ADR-0077 的依赖边界，并让基座固定 Coding 的摘要、Memory 与扩展模型。

### 在 Runtime Core 增加完整默认摘要算法

摘要 Prompt、切点质量和 Provider 降级都存在真实领域差异。Runtime 只应提供可组合合同和通用机制；具体 Agent 可以选择
透传默认 Context，也可以注入自己的 Strategy。

### 只拆文件，不下沉通用状态

会保留重复 usage 与熔断实现，无法让其它主 Agent开箱复用，也无法建立统一测试合同。

## 后果

- 自定义 Agent 可以直接复用 Context usage 与连续失败保护，同时完全自定义 Context/Compaction 策略。
- Coding Agent 的持久化格式、事件顺序和用户行为不变，但职责更局部，后台 Prefire 可独立观测并向上层 Hub 汇聚。
- Runtime 公共 API 增加两个机制，需要 Runtime 单元测试以及 Coding、Desktop 消费合同测试。
