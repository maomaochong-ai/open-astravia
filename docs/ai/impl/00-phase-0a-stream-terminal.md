# Phase 0A：流终止与 Agent Loop 异常传播

## 1. 阶段目标

本次只处理两个可导致调用方永久等待的基础缺陷：

1. `EventStream.end()` 在没有终态事件或显式结果时结束迭代，但 `result()` 永不 settlement。
2. `agentLoop()` / `agentLoopContinue()` 内部异步任务抛错时形成未处理 rejection，返回的事件流和 `result()` 永不 settlement。

完成标准：

- 成功、显式失败和缺失终态三类路径均在有限时间内结束。
- iterator 与 `result()` 对同一个失败给出一致结果。
- 正常终态事件仍先交付给消费者，再结束迭代。
- 原有 Agent loop 正常、续跑和工具调用行为不回归。

本次不处理：abort 语义统一、消费者提前退出、checkpoint 协议替换、tool loop budget、Provider 大规模迁移和类型归位。这些仍属于后续 Phase 0B 至 Phase 5。

## 2. 修改前证据

先写回归测试再修改实现，得到以下失败：

| 场景 | 修改前实际行为 | 风险 |
| --- | --- | --- |
| `EventStream.end()` 无结果 | iterator 结束，但 `result()` 在短超时后仍为 pending | 请求状态、UI 和上层 Runtime 可永久等待 |
| Agent stream factory 抛错 | Vitest 报未处理 rejection；iterator 与 `result()` 均超时 | 异常绕过事件通道，调用方既收不到错误也无法收尾 |
| Agent 下游模型流失败 | 顶层 fire-and-forget promise 未接住异常 | 同上，且错误来源难追踪 |

回归测试最初失败符合预期，证明测试命中了缺陷而不是只验证新实现。

## 3. 实现内容

### 3.1 EventStream 终止契约

`packages/ai/src/utils/event-stream.ts` 现在具有三个明确终态：

| 终态 | iterator | `result()` |
| --- | --- | --- |
| terminal event / `end(result)` | 交付已排队事件后完成 | resolve 终态结果 |
| `fail(error)` | 交付已排队事件后 reject | reject 同一个 error |
| `end()` 且无终态结果 | reject `EventStreamEndedWithoutResultError` | reject 同一个 error |

具体改动：

- 新增公共错误 `EventStreamEndedWithoutResultError`，稳定错误码为 `EVENT_STREAM_ENDED_WITHOUT_RESULT`。
- 新增 `fail(error)`，让生产者显式关闭失败通道。
- 等待 iterator 的队列从单一 `resolve` 改为 `{ resolve, reject }`，失败可以同时唤醒所有等待者。
- `isComplete` 或 `extractResult` 本身抛错时，自动进入失败终态。
- `end(...args: [] | [R])` 用参数个数区分“未提供结果”和“显式提供 `undefined`”，因此 `R = undefined` 仍是合法结果类型。
- 终态事件仍会进入事件队列；消费方先看到 `done/error`，下一次迭代才完成。
- 内部为 final-result promise 注册空 rejection handler，防止只消费 iterator 的合法用法产生进程级未处理 rejection；对调用方返回的 promise 仍保持 reject 语义。

### 3.2 Agent loop 顶层失败传播

`packages/agent/src/agent-loop.ts` 的两个后台异步入口都显式接住 `runLoop()` 的 rejection，并调用 `stream.fail(error)`：

- 新用户消息入口 `agentLoop()`。
- 从现有上下文继续的 `agentLoopContinue()`。

这没有把异常伪装成普通业务事件。异常仍以 Promise rejection 传播，只是 iterator 和 `result()` 现在遵守同一个有限终止契约。

### 3.3 测试源码解析

`packages/agent/vitest.config.ts` 增加 `@vetta/ai -> ../ai/src/index.ts` alias。原因是 Agent 测试原先解析到已构建的 `packages/ai/dist`，新增源码 API 不存在于旧 dist，导致测试实际没有覆盖工作区源码组合。

该 alias 是测试正确性的必要修复，但也暴露出其他上游 Vitest 配置可能同样混用源码和陈旧 dist。全仓 alias 审计留到测试基础设施阶段处理。

## 4. 采用的模式与理由

### 显式终态状态机

流不再把“iterator 已结束”等同于“结果已产生”。成功和失败都必须有明确终态，缺失终态属于协议错误。这个约束能尽早暴露 Provider 静默断流，而不是让上游把不完整响应当作成功。

### 双观察通道一致性

同一条流既可通过 `for await` 观察，也可通过 `result()` 观察。两条通道共享同一个终态和 error identity，避免 iterator 失败但 `result()` 悬挂，或反之。

### 失败不事件化

本阶段没有新增泛化的 `error event` 包装所有异常。Provider 返回的协议错误事件仍按既有 `AssistantMessageEvent` 工作；基础设施异常通过 rejection 传播。这样保留了业务终态与执行失败的区别，为 Phase 1 的结构化错误协议留下空间。

### 源码优先的包级测试

工作区测试必须验证当前源码组合，不能隐式依赖历史构建产物。短期用 Vitest alias 修正 Agent 边界；长期应统一 workspace test resolver，避免每个包手工维护不完整 alias。

## 5. 测试设计

### EventStream 契约测试

新增 `packages/ai/test/event-stream.test.ts`，覆盖：

1. 无终态 `end()` 同时拒绝 iterator 与 `result()`。
2. `end(result)` 显式结果正常 resolve。
3. 显式 `end(undefined)` 与缺失参数可区分。
4. terminal event 被交付后迭代才完成。
5. `fail(error)` 在两条观察通道保留同一 error。
6. `extractResult` 抛错转成流失败。
7. 失败在短契约超时内 settlement，防止测试本身永久挂起。

### Agent loop 功能测试

新增 `packages/agent/test/agent-loop-failure.test.ts`，覆盖：

1. `agentLoopContinue()` 的 stream factory 同步抛错。
2. `agentLoop()` 新消息入口的 stream factory 同步抛错。
3. 初始 `getSteeringMessages()` 异步失败。
4. 下游模型流调用 `fail(error)`。
5. 下游模型流调用无结果 `end()`，缺失终态错误穿透 Agent loop。

这些测试断言可观察结果和有限终止时间，不断言私有字段或偶然调用顺序。

## 6. 验证结果

### 直接与回归测试

| 命令/范围 | 结果 |
| --- | --- |
| AI EventStream 契约测试 | 7/7 通过 |
| Agent failure 契约 + 原有 loop/continue 测试 | 18/18 通过 |
| `packages/agent` 全量 `bun run test` | 53 通过，43 条凭据/环境测试跳过，0 失败 |
| 根目录 `bun run check:quick` | 通过；Biome 与全部架构/边界守卫无错误 |
| 根目录 `bun run check` | 通过；lint、根/CLI/Desktop/Admin/Docs 类型检查及全部架构守卫无错误 |

### AI 包全量测试

`packages/ai` 的 `bun run test` 未通过：

- 20 个测试文件通过，8 个跳过。
- 8 个测试文件在收集期因 `getModel()` 返回 `undefined` 或 `MODELS` 缺失对应 provider 而失败。
- `supports-xhigh` 3 项和 Bedrock 模型目录 1 项因模型数据为空失败。
- 5 个 cache-retention 测试在传入 `undefined` 模型后触发后台异常并等待到 30 秒超时。
- 新增 EventStream 测试 7/7 通过。

这些失败集中指向生成模型目录和 deterministic 测试的耦合。当前改动没有修改模型目录，但全量门禁仍然是红色，不能记录为“环境无关的通过”。后续必须把固定功能测试迁移到受版本控制的 model fixtures，并让缺凭据的 live suite 在构造模型前完成跳过判断。

## 7. 预期与实际对比

| 项目 | 预期 | 实际 | 判断 |
| --- | --- | --- | --- |
| 无终态流 | 有限失败 | iterator/result 均拒绝稳定错误码 | 达成 |
| Agent 顶层异常 | 不再未处理且不悬挂 | 两条观察通道拒绝原始错误 | 达成 |
| 正常 loop 行为 | 无回归 | 原有 loop/continue 测试全部通过 | 达成 |
| Agent 包全量 | 通过或合理跳过 | 53 通过、43 跳过、0 失败 | 达成 |
| AI 包全量 | deterministic 默认全绿 | 模型目录耦合导致既有失败 | 未达成，进入后续基础设施工作 |
| 工作区源码测试 | Agent 使用当前 AI 源码 | Agent 已修正；其他上游尚未审计 | 部分达成 |

## 8. 已完成与未完成

已完成：

- EventStream 缺失终态不再悬挂。
- EventStream 显式失败可同时终止 iterator/result。
- Agent loop 两个入口的顶层异步失败均进入流失败通道。
- 新旧正常路径与失败路径有独立回归测试。
- Agent 包全量测试和快速质量门禁通过。

未完成：

- abort 与消费者主动取消的统一语义。
- checkpoint callback 永不返回时的超时/取消策略。
- 无限 tool loop 的预算终止。
- canonical normalizer 与 legacy characterization report。
- deterministic、credential-gated、live canary 的配置级拆分。
- AI 模型目录测试 fixture 化，以及 cache-retention 测试消除后台超时。
- runtime-core、coding-agent 等上游测试的源码 alias 一致性审计。
- Phase 0 其余阻断性缺陷尚未进入实现。

因此，本记录只将 Phase 0A 标记为“已实现”，不将整个 Phase 0 标记为完成。

## 9. 涉及文件

- `packages/ai/src/utils/event-stream.ts`
- `packages/ai/test/event-stream.test.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/test/agent-loop-failure.test.ts`
- `packages/agent/vitest.config.ts`
- `docs/ai/impl/README.md`
- `docs/ai/impl/00-phase-0a-stream-terminal.md`

## 10. 下一步入口

下一实施批次应优先完成 Phase 0B，而不是直接开始移动 Provider 文件：

1. 建立固定 model fixtures，使 deterministic 测试不依赖生成目录或凭据。
2. 把 AI 测试显式分成 unit/contract、credential-gated integration 和 live canary。
3. 为 abort、checkpoint pending、tool loop budget 写修改前回归测试。
4. 建立 canonical event/result normalizer，为后续协议和 Provider 差分测试提供基线。
5. 审计上游 Vitest 的 workspace source resolution，保证重构期测试覆盖同一份源码。
