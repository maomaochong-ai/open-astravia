# Phase 5C：Stateless Engine 生产切换

## 目标与退出条件

本阶段把 Phase 5B 的并行 Runtime Adapter 变为生产 `AgentCoreTurnEngine`，但不扩大公共 API。切换前要求：

- 现有 16 条生产 Engine 契约全部在新实现上通过。
- agent、generation、tool observation 与既有 tracing 策略兼容。
- checkpoint、失败、取消和队列行为有直接测试，不依赖 UI 验证。
- Runtime Core、Runtime Tools、Coding Agent 和根质量门均能验证同一轮工作区源码。

## 模块收口

| 模块 | 职责 | 公共性 |
| --- | --- | --- |
| `agent-core-turn-engine-options.ts` | 稳定的 Runtime 组合参数契约 | 通过原 `AgentCoreTurnEngine` 入口导出 |
| `agent-core-turn-engine.ts` | 保持公共类名的薄 facade | 公共 |
| `stateless-agent-core-turn-engine.ts` | Frame、checkpoint、queue、tool、stream 和事件投影适配 | 内部 |
| `agent-engine-telemetry.ts` | 从 Engine 事件构建 agent/generation/tool observation | 内部 |
| `agent-event-delivery-barrier.ts` | 保证 checkpoint 不越过已发出但尚未交付的 Runtime 事件 | 内部 |

公共 `AgentCoreTurnEngine` 继承内部 stateless 实现。Coding Agent composition 和 Runtime Host 不需要改构造方式，`StatelessAgentCoreTurnEngine` 不从 kernel index 导出，避免把迁移期名称固化为新 API。

## Telemetry 适配

Telemetry 只订阅 `AgentExecutionEvent`，没有进入通用 Agent Engine：

- 一个 Turn 创建一个 `agent.run` observation。
- 每次模型调用创建独立 generation observation，记录 model parameters、usage、cost 和终态。
- 每个工具调用创建 tool observation，记录 argument keys、update/phase 汇总、耗时和错误状态。
- `detail: "agent"` 禁止创建 generation/tool 子 observation。
- `captureContent` 默认关闭；关闭时只记录数量、类型、工具名与参数键，不记录用户正文、工具参数值或工具输出正文。
- 根 observation 合并业务 `tracing.metadata`，但用当前请求的 Session 身份覆盖陈旧 `sessionId`。
- 根与子 observation 都使用幂等终止；failed/cancelled result 随后被 Runtime 抛出时，不会重复 `end()` 或 `flush()`。

## checkpoint 事件顺序

新 Engine 的生产协程可以快于 Runtime 的异步事件消费者。初次矩阵发现 checkpoint callback 可能先于已生成的 assistant/toolResult 投影执行，这会改变持久化顺序。

Runtime Adapter 因此增加事件交付屏障：Engine observer 同步记录 emission；Adapter 在所有对应 `TurnEngineEvent` yield 完成后记录 consumption；checkpoint 等待调用时刻之前的 emission 全部交付。该机制不改变 Agent Engine 的状态模型，也不把 Runtime 持久化端口放进 Agent 包。

## 失败、取消与 signal

- Provider `error` terminal 现在拒绝 Turn，保留结构化 `AI_TRANSPORT_FAILED`，不再伪装为 `completed(error)`。
- 取消拒绝为 `AbortError`，由 Turn Pipeline 转为 cancelled；失败/取消均不消费待处理 follow-up。
- 未配置 deadline 时，Agent Engine 直接使用请求原始 signal，保持 provider/host 身份契约。
- 配置 deadline 时才创建派生 signal；父取消仍传播到派生 signal，deadline timer 在 Run 结束时释放。

这两种 signal 路径有 Agent Engine 直接测试，Runtime 生产测试同时验证原始 signal 透传和取消拒绝。

## 上游测试解析修复

Coding Agent Vitest 原本把 `runtime-core` 指向源码，却让其新依赖的 `agent-core` 解析旧 dist，形成不一致模块图并报 `salvageTextToolCalls is not a function`。测试配置补充 `@vetta/agent-core` 与 `@vetta/ai` 源码别名，使工作区测试验证同一轮源码。没有运行 build 刷新 dist。

## 测试证据

直接覆盖：

- 16 条生产 `AgentCoreTurnEngine` 契约全部运行新实现。
- 5 条 Runtime Adapter/facade canonical、checkpoint、失败和取消测试。
- 4 条 telemetry 测试覆盖成功工具循环、Provider 失败、取消竞态、agent-only 和内容隐私。
- Agent Engine 新增 2 条 signal/deadline 测试；相关文件共 22 条通过。

包级结果：

- AI：34 个测试文件、159 条通过。
- Agent：16 个测试文件、93 条通过。
- Runtime Core：33 个测试文件、161 条通过。
- Runtime Tools：26 个测试文件、231 条通过。
- Coding Agent：154 个测试文件、991 条通过，17 条按既有环境条件跳过。
- `bun run check:quick`：通过。
- 根 `bun run check`：lint、root/CLI/desktop/admin/docs 类型检查及全部 guards 通过。
- UI 测试按用户明确要求未运行；本阶段没有 UI 改动。

## 预期与实际

预期只需补 tracer 后替换默认类。实际兼容矩阵发现 checkpoint 交付顺序和 signal 身份两项隐藏契约，上游全量又发现 tracing metadata 与测试源码/dist 混用问题。四项都由可复现测试驱动修复，没有通过放宽断言保留错误行为。

Provider error 与取消的旧 `completed` 行为没有保留。这是有意的长期语义修正：正常完成与失败必须走不同终态，Turn Pipeline 已承担产品级 failed/cancelled 映射。

## 尚未完成

- `packages/agent` 的兼容 Agent facade 和旧 loop 仍有调用方，需在 Phase 7 按发布周期退出，不能立即删除。
- 其余 5 个 Provider API 仍通过 AI legacy bridge；`streamSimple()` compatibility projection 暂时保留。
- Coding Agent 非适配层仍存在 Agent 类型依赖，类型所有权归位继续属于 Phase 5 后续工作。
- live Provider canary 仍受凭据条件约束。
