---
name: software-design-patterns
description: Guide an AI coding agent to select, reject, combine, and implement software design patterns. Covers GoF 23 patterns, enterprise application patterns, DDD patterns, and distributed-system reliability patterns. Use when reviewing architecture, refactoring code, designing extensibility, modeling domains, or diagnosing coupling/branching/state/transaction/reliability problems.
---

# Software Design Patterns Skill

这个 Skill 用于帮助 Agent **根据真实设计压力选择设计模式，而不是为了“使用模式”而套模式**。

## 核心原则

1. **先识别变化点，再选择模式。** 先问：什么在变化？变化频率如何？变化是否已经造成维护成本？
2. **优先最小复杂度。** 如果简单分支、普通函数、组合、语言原生特性已经足够，不要引入模式。
3. **模式必须有可验证收益。** 收益通常是降低耦合、隔离变化、维护不变量、明确事务边界、提高可靠性或可测试性。
4. **模式有成本。** 接口、对象、间接调用、状态、异步、持久化和运维复杂度都必须计入。
5. **不要以“未来可能需要”为唯一理由过度设计。** 只有当变化有证据或当前结构已经产生明显压力时，才引入额外抽象。

## Agent 默认工作流

收到代码设计、重构或架构问题时：

1. **描述当前问题**：指出条件分支、耦合、职责、状态、事务、一致性或可靠性压力。
2. **定位问题层级**：对象创建 / 对象组合 / 行为变化 / 应用分层 / DDD / 分布式系统。
3. **先读 [设计模式决策指南](references/decision-guide.md)**，筛出最多 3 个候选。
4. **打开候选模式的独立文件**，检查“什么时候使用”和“什么时候不要使用”。
5. **选择最小方案**：如果不需要模式，明确建议保持简单。
6. **如果使用多个模式**，再读 [常见模式组合](references/pattern-combinations.md)，确保职责不重叠。
7. **给出落地方案**：对象职责、调用方向、扩展点、测试点，以及引入成本。

## 深度分析约定

参考文件不是名词解释，而是设计决策记录。使用某个模式时，必须把它放回当前代码的变化轴和运行时边界中分析：

1. **先写压力，不先写模式**：指出变化频率、失败后果、并发/事务边界，以及当前结构为什么已经产生成本。
2. **区分静态结构与动态行为**：说明依赖方向、对象生命周期、调用顺序、错误传播和数据所有权；不要只列类名。
3. **给出最小落地形状**：列出角色、接口所在层、创建/装配位置和一次请求或消息的时序。示例应能映射到现有 TypeScript、Go 或 Kotlin 代码，而不是抽象框架。
4. **明确负担与退出条件**：量化或描述新增间接层、状态、网络跳数、存储和运维成本，并说明何时应回退到函数、普通组合或平台能力。
5. **把验证写进设计**：为不变量、边界错误、重试/取消/并发和可观测性列出最低测试与指标；异步模式必须说明重复、乱序和恢复策略。

每个模式参考文件的“深度分析”段落均按上述维度编写。若当前问题无法满足该段落的采用条件，应明确推荐“不使用该模式”，而不是为了完整性强行套用。

## 快速路由：什么时候优先看什么

| 设计压力 | 首选候选 | 通常不该用的情况 |
|---|---|---|
| `if/switch(type)` 随实现数量增长 | Strategy + Factory Method | 分支少且稳定 |
| `if/switch(status)` 散落 | State | 状态仅是数据标签 |
| 固定流程中少数步骤变化 | Template Method | 变化维度多、组合需求强 |
| 连续规则/过滤且可短路 | Chain of Responsibility | 步骤强耦合、全部必须执行 |
| 一个事实触发多个反应 | Observer / Domain Event | 强一致动作必须同事务完成 |
| 第三方/遗留接口不兼容 | Adapter | 接口本来就兼容 |
| 横切访问控制、事务、远程替身 | Proxy | 只是动态叠加功能时更像 Decorator |
| 功能可按需层层增强 | Decorator | 包装顺序复杂到难以理解 |
| 两个正交变化维度导致类爆炸 | Bridge | 只有一个变化维度 |
| 创建参数多、构造分阶段 | Builder | 简单构造/命名参数已足够 |
| 需要成套切换产品族 | Abstract Factory | 只有一种产品 |
| 复杂子系统需要统一入口 | Facade | Facade 只是无价值转发 |
| 树形结构统一处理叶子/容器 | Composite | 实际是图或行为差异巨大 |
| 领域对象需要稳定身份 | Entity | 只由值决定时用 Value Object |
| 领域对象只由值决定 | Value Object | 有独立身份/生命周期 |
| 强一致对象组需要事务边界 | Aggregate + Aggregate Root | 只是数据库关联关系 |
| 领域规则不自然属于实体 | Domain Service | 只是应用编排或技术服务 |
| 聚合持久化需要隔离 ORM | DDD Repository | 简单 CRUD 或报表查询 |
| DB 更新 + MQ 发布双写 | Outbox | 没有跨进程事件传播 |
| 网络瞬态失败 | Retry | 永久错误、非幂等写 |
| 持续故障导致资源耗尽 | Circuit Breaker + Bulkhead | 本地廉价调用 |
| 跨服务长事务 | Saga | 单库 ACID 足够 |
| 写模型复杂、读模型差异大 | CQRS | 普通 CRUD |
| 需要完整事实历史/重放 | Event Sourcing | 只为审计日志 |
| 重复请求/消息不能重复副作用 | Idempotency | 天然幂等读操作 |

## 不应使用设计模式的典型情形

- 为了消除一个很小、很稳定的 `if` 就引入多个接口和类。
- 当前只有一个实现，并没有真实扩展压力。
- 用模式掩盖错误的领域边界、数据模型或职责划分。
- 为简单 CRUD 引入 DDD 全家桶、CQRS、Event Sourcing 或 Saga。
- 团队无法测试、观测或运维新增的异步/分布式复杂度。
- 框架或平台已有成熟能力，却在应用层重复造轮子。
- 把“设计模式数量”当代码质量指标。

## 输出要求

当 Agent 使用本 Skill 给出建议时，应尽量包含：

- **问题信号**：具体哪里在变化或耦合。
- **主模式**：优先只选一个最关键模式。
- **辅助模式**：只有职责确实不同且必要时才添加。
- **不选其他模式的原因**：至少比较一个相近候选。
- **最小实现结构**：给类/模块职责和依赖方向，而不是先造框架。
- **不使用该模式的退出条件**：如果需求规模下降或假设不成立，应保持/回退到更简单设计。
- **测试与可观测性**：尤其是事件、重试、Saga、Circuit Breaker、状态机等模式。

## 模式索引

### GoF / 创建型

- [单例模式（Singleton）](references/gof/creational/singleton.md)
- [工厂方法模式（Factory Method）](references/gof/creational/factory-method.md)
- [抽象工厂模式（Abstract Factory）](references/gof/creational/abstract-factory.md)
- [建造者模式（Builder）](references/gof/creational/builder.md)
- [原型模式（Prototype）](references/gof/creational/prototype.md)

### GoF / 结构型

- [适配器模式（Adapter）](references/gof/structural/adapter.md)
- [桥接模式（Bridge）](references/gof/structural/bridge.md)
- [组合模式（Composite）](references/gof/structural/composite.md)
- [装饰器模式（Decorator）](references/gof/structural/decorator.md)
- [外观模式（Facade）](references/gof/structural/facade.md)
- [享元模式（Flyweight）](references/gof/structural/flyweight.md)
- [代理模式（Proxy）](references/gof/structural/proxy.md)

### GoF / 行为型

- [责任链模式（Chain of Responsibility）](references/gof/behavioral/chain-of-responsibility.md)
- [命令模式（Command）](references/gof/behavioral/command.md)
- [解释器模式（Interpreter）](references/gof/behavioral/interpreter.md)
- [迭代器模式（Iterator）](references/gof/behavioral/iterator.md)
- [中介者模式（Mediator）](references/gof/behavioral/mediator.md)
- [备忘录模式（Memento）](references/gof/behavioral/memento.md)
- [观察者模式（Observer）](references/gof/behavioral/observer.md)
- [状态模式（State）](references/gof/behavioral/state.md)
- [策略模式（Strategy）](references/gof/behavioral/strategy.md)
- [模板方法模式（Template Method）](references/gof/behavioral/template-method.md)
- [访问者模式（Visitor）](references/gof/behavioral/visitor.md)

### 企业应用模式

- [仓储模式（Repository）](references/enterprise/repository.md)
- [服务层模式（Service Layer）](references/enterprise/service-layer.md)
- [工作单元模式（Unit of Work）](references/enterprise/unit-of-work.md)
- [数据映射器模式（Data Mapper）](references/enterprise/data-mapper.md)
- [活动记录模式（Active Record）](references/enterprise/active-record.md)
- [数据传输对象模式（Data Transfer Object）](references/enterprise/dto.md)
- [依赖注入模式（Dependency Injection）](references/enterprise/dependency-injection.md)
- [模型-视图-控制器模式（Model-View-Controller）](references/enterprise/mvc.md)

### DDD 模式

- [实体模式（Entity）](references/ddd/entity.md)
- [值对象模式（Value Object）](references/ddd/value-object.md)
- [聚合模式（Aggregate）](references/ddd/aggregate.md)
- [聚合根模式（Aggregate Root）](references/ddd/aggregate-root.md)
- [DDD 仓储模式（DDD Repository）](references/ddd/repository.md)
- [领域服务模式（Domain Service）](references/ddd/domain-service.md)
- [领域事件模式（Domain Event）](references/ddd/domain-event.md)
- [应用服务模式（Application Service）](references/ddd/application-service.md)
- [DDD 工厂模式（DDD Factory）](references/ddd/factory.md)
- [规约模式（Specification）](references/ddd/specification.md)

### 分布式系统模式

- [Saga 模式（Saga）](references/distributed/saga.md)
- [CQRS 模式（Command Query Responsibility Segregation）](references/distributed/cqrs.md)
- [事件溯源模式（Event Sourcing）](references/distributed/event-sourcing.md)
- [事务发件箱模式（Transactional Outbox）](references/distributed/outbox.md)
- [断路器模式（Circuit Breaker）](references/distributed/circuit-breaker.md)
- [重试模式（Retry）](references/distributed/retry.md)
- [舱壁模式（Bulkhead）](references/distributed/bulkhead.md)
- [API 网关模式（API Gateway）](references/distributed/api-gateway.md)
- [服务发现模式（Service Discovery）](references/distributed/service-discovery.md)
- [幂等模式（Idempotency）](references/distributed/idempotency.md)
- [领导者选举模式（Leader Election）](references/distributed/leader-election.md)
