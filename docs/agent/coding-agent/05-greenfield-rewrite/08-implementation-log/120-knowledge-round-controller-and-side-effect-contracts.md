# 第 120 轮：Knowledge Round Controller 与轮级副作用合同

## 目标

- 将 Knowledge Poller 的定时调度壳与单轮加工状态机分开。
- 保持 diff、批次、Writer、缓存、失败对账、raws 锁和临时目录行为不变。
- 在稳定 `KnowledgeProcessingSessionFactory` Port 上验证成功、批次失败和并发中止。
- 补齐第 119 轮尚未覆盖的 processing record、usage、通知、锁和资源释放合同。

## 实施判断

原 `poller.ts` 同时负责产品装配、定时任务、配置响应、轮级互斥、并发 Session、缓存重建和观察副作用。
其中后六项形成一个有状态的产品用例，继续留在调度入口会导致它只能通过 Electron 模块整体测试。

本轮只抽取一个 `KnowledgeRoundController`：

```text
poller.ts
  配置 / scheduler / Desktop 产品装配
          |
          v
KnowledgeRoundController
  run / abort / maintenance / snapshot
          |
          +--> KnowledgeProcessingSessionFactory
          |      Legacy | Greenfield
          |
          +--> 真实 Knowledge diff / batch / writer / cache / failure
          |
          +--> Desktop effects / raws lock / temporary directory
```

Controller 是 Desktop Knowledge 产品编排，不是 Runtime Core，也不是新的通用 Pipeline。Knowledge 算法继续
直接使用现有实现；只把宿主副作用和 Session 创建边界注入，避免制造一个覆盖全部 Knowledge 函数的巨型 Port。

## 修改

### 轮级 Controller

新增 `KnowledgeRoundController`，集中持有：

- 单轮 `running` / `processing` 状态和完成信号。
- 当前活动 Session 集合及 abort 协调。
- 轮内共享 `KbWriteSession`。
- 并发批次执行及排队批次的中止检查。
- 中间缓存重建、最终失败对账和异步 processing result。
- Snapshot 合并调度。
- maintenance 与 retry failed 的互斥。

`poller.ts` 现在只负责：

- 选择 Legacy/Greenfield Knowledge Processing Factory。
- 组合 Desktop 广播、监控记录、日志、raws 锁和临时目录适配器。
- 读取配置、设置环境变量和管理定时任务。
- 通过原有导出委托 Controller，保持外部调用入口不变。

### 真实文件系统行为合同

测试没有伪造 Knowledge diff、批次规划、Writer、缓存或失败文件，而是只提供确定性的 Session Factory Port：

1. 成功场景写入 21 个 raws 文件，触发两个真实批次。
2. 两个批次向相同语义 wiki path 写入，验证共享 Writer 的 PageIndex 和串行提交边界。
3. 验证 21 个 wiki 页、manifest、旧失败记录清除、usage、processing result、Snapshot、通知、raws 锁、
   临时目录和 Session 释放。
4. 失败场景让第二批 Provider 抛错，确认第一批 20 个写入保留，同时锁、临时目录、订阅和 Session 完整释放。
5. 中止场景使用 41 个 raws 文件和并发度 2：两个活动 Session 都收到 abort，第三个排队批次不会创建
   Session，不产生写入、usage 或失败对账，并完成最终 Snapshot 和资源清理。

## 兼容性发现

当前实现只有在所有批次完成后才执行 `reconcileRoundFailures()`。因此 Provider 或批次直接抛错时：

- 已完成批次的写入会保留。
- 整轮 Promise 会 rejection。
- 不执行最终 processing result 和 Snapshot。
- 本轮尝试不会累计失败次数，也不会触发隔离。

这是抽取前已有的可观察行为。本轮测试将它固定为迁移基线，没有把“异常批次也应对账”作为架构修改夹带实施。
是否改变该行为需要单独确定失败重试、部分成功和隔离语义。

## 明确未修改

- Desktop 和 Knowledge Poller 默认仍为 Legacy；Greenfield 继续显式 opt-in。
- 没有修改批次上限、字节上限、默认并发度或队列算法。
- 没有修改 Prompt、Todo、Tool 名称、描述、Schema、执行结果或 Writer 行为。
- 没有修改 processing record、failure record、缓存、通知和 raws 锁的既有时序。
- 没有扩展 `KnowledgeProcessingSessionFactory`，也没有让 Controller 依赖具体 Legacy/Greenfield Session。
- 没有移动 scheduler、Desktop 配置或 Electron 广播到 Coding Agent。

## TypeBox / Zod 判断

新增依赖均是进程内 TypeScript Port，输入来自已经类型化的 Desktop 配置和 Session Factory。没有新增 RPC、
配置文件或持久化反序列化边界，因此不需要 TypeBox/Zod。Knowledge 持久化数据继续使用既有校验实现。

## 验证

- `KnowledgeRoundController` 成功、失败、中止：1 个文件、3 项测试通过。
- Legacy/Greenfield `KnowledgeProcessingSessionFactory`：1 个文件、2 项测试通过。
- `bun run check:quick` 通过。
- `bun run check` 通过，覆盖 Biome、Root/CLI/Desktop/Admin 类型检查和质量守卫。

## 下一步

下一阶段不应立即切换默认值，应先完成生产灰度准备：

1. 单独决定 Provider 抛错时是否应对已尝试文件执行失败对账；若改变，作为明确的功能修复实施。
2. 在真实 Desktop 进程中显式启用 Greenfield Knowledge Processing，验证启动、手动整理、中止、重启和监控
   观察，不依赖 workspace 内部测试入口。
3. 确认无新增行为差异后，再把 Knowledge Poller 默认切换和回退 selector 作为独立阶段。

