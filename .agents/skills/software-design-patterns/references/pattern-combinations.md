# 常见模式组合

设计模式很少孤立出现。Agent 应优先理解职责组合，而不是机械堆叠。

## Strategy + Factory Method

**适用：** 多种算法/渠道 + 运行时选择实现。Factory 负责选择/创建，Strategy 负责算法本身。

**不要：** 让 Factory 同时执行策略业务；也不要让调用方既使用 Factory 又再次 `switch(type)`。

## Adapter + Dependency Injection

**适用：** 外部供应商接口适配为内部端口，再由 DI 注入具体 Adapter。

**不要：** 把第三方 SDK 类型暴露给领域层。

## Repository + Unit of Work + Data Mapper

**适用：** 富领域模型、本地 ACID 事务。Repository 负责聚合访问，Data Mapper 负责映射，UoW 负责一次用例的提交。

**不要：** 每个 Repository 私自 commit；不要用这组模式解决跨服务事务。

## Aggregate + Aggregate Root + Domain Event + DDD Repository

**适用：** DDD 写模型。Aggregate Root 维护不变量，通过 Repository 持久化，并产生 Domain Event。

**不要：** 用事件完成聚合内部必须立即满足的强一致规则。

## Domain Event + Outbox + Idempotency

**适用：** 可靠跨进程事件传播。事务内写 Outbox，异步发布；消费者按 event/business key 幂等。

**不要：** 误以为 Outbox 等于 exactly-once。

## Retry + Circuit Breaker + Bulkhead + Timeout

**适用：** 远程调用韧性。Timeout 限制单次等待；Retry 处理瞬态故障；Circuit Breaker 对持续故障快速失败；Bulkhead 隔离资源。

**不要：** 多层无限重试，或对非幂等写盲目重试。

## Saga + Outbox + Idempotency

**适用：** 跨服务业务事务。Saga 组织步骤/补偿，Outbox 可靠发布，Idempotency 应对重复消息和重试。

**不要：** 把补偿当数据库 rollback；补偿本身也可能失败。

## CQRS + Event Sourcing

**适用：** 写侧复杂、需要事件事实源和多读模型时可组合。

**不要：** 把两者视为绑定关系。CQRS 可以不用 Event Sourcing，Event Sourcing 也不要求复杂双库 CQRS。

## Command + Memento

**适用：** 编辑器、工作台等需要操作对象化 + undo/redo。

**不要：** 对无法逆转的外部副作用假装可以简单 undo。

## Composite + Visitor

**适用：** 稳定树形结构上持续增加新操作，如 AST 分析、打印、优化。

**不要：** 节点类型频繁增加时，Visitor 的修改成本会很高。

## 组合落地时的顺序与不变量

多个模式同时出现时，按“边界先于机制”的顺序落地：

1. 先确定领域/应用边界和数据所有权（Aggregate、Service Layer、Repository）。
2. 再隔离变化实现（Adapter、Strategy、Factory、Bridge、Decorator）。
3. 最后加入跨进程可靠性（Outbox、Idempotency、Retry、Circuit Breaker、Saga）。

每增加一个模式，都要回答三个问题：谁创建并拥有它、失败时谁负责恢复、如何从指标或日志观察它。常见的不变量包括：

- **一次提交一个本地事务**：Repository 不私自提交，Outbox 与业务写入同事务。
- **至少一次不等于一次**：事件消费者和命令处理器必须按业务键幂等，并能安全重放。
- **超时先于重试，重试受总预算约束**：避免多层重试形成流量放大。
- **读模型可重建**：CQRS 投影带版本和游标，重建不修改写侧事实源。
- **租约会失效**：Leader Election 的写入带 fencing token，旧 leader 不能继续提交。

如果组合后的调用链无法在一次故障演练中解释清楚，先拆掉辅助模式，保留解决主压力的那一个。
