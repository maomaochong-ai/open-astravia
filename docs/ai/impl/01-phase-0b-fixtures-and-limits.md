# Phase 0B：测试模型基线与有限执行预算

## 1. 阶段目标

本阶段处理 Phase 0A 暴露的两类基础问题：

1. `packages/ai` 的旧测试仍依赖已经被架构决策删除的生产内置模型目录，导致无凭据环境也无法收集测试。
2. Agent context checkpoint、模型调用循环和工具调用循环缺少统一的有限执行约束。

完成标准：

- 不恢复生产内置模型目录的前提下，AI deterministic 测试可以稳定收集和运行。
- 缺凭据测试在完成测试定义后被明确跳过，不因构造 `undefined` 模型而报错或超时。
- 未完成 checkpoint 可由 timeout 或 abort 有限结束。
- 模型调用与工具调用都有默认有限预算，超限前停止执行并稳定报错。
- `limits` 可由 standalone Agent 和 Runtime AgentCore adapter 配置。

本阶段不完成测试命令的物理分层，也不建立 canonical event/result normalizer；它们进入 Phase 0C。

## 2. 根因分析

### 2.1 空模型目录不是生成失败

Git 历史显示提交 `2e6ecf65d` 在 2026-04-03 主动完成以下架构调整：

- 清空 `packages/ai/src/models.generated.ts`。
- 删除公网模型拉取脚本。
- 生产模型改由 `models.json` 和服务端配置提供。

因此 Phase 0A 中 `getModel()` 返回 `undefined` 不是本地遗漏构建步骤，而是测试仍依赖被删除的旧架构。恢复旧的约 1.3 万行目录会重新引入双模型源，违背当前产品架构。

### 2.2 checkpoint 是无截止时间的双向事件 RPC

`requestContextCheckpoint()` 只在宿主调用 `complete()` / `fail()` 时 settlement：

- 宿主漏处理事件时永久等待。
- AbortSignal 不会解除等待。
- 不存在默认 deadline。

这也是方案中要求 Phase 4 最终用 callback checkpoint 替换双向 event RPC 的原因。本阶段先修复有限终止，不提前完成所有权迁移。

### 2.3 Agent loop 没有资源预算

模型只要持续返回 tool calls，Agent loop 就会继续调用模型和执行工具。原实现没有模型调用次数或累计工具调用次数限制；外部 abort 只能在调用方主动介入时终止，不能保护无人值守任务。

## 3. 实现内容

### 3.1 受控测试模型目录

新增 `packages/ai/test/fixtures/model-catalog.ts`：

- 只列出现有测试实际引用的 Provider/model ID。
- 使用 Provider 级 fixture 定义 API 类型和 base URL，模型共享稳定的能力、成本和窗口默认值。
- 对 GitHub Copilot 这类同一 Provider 跨协议族的模型按 ID 选择 API。
- 不读取网络、用户目录、服务端配置或环境凭据。

`packages/ai/test/setup.ts` 在 Vitest setup 阶段把 fixture 安装到空的 `MODELS` 对象。生产构建不加载该文件，`models.generated.ts` 继续保持空目录。

新增 `model-fixtures.test.ts` 自检：

- Bedrock 和 OpenCode fixture 均存在，防止 skipped suite 在定义阶段访问空对象。
- Anthropic、OpenAI Responses、OpenAI-compatible、Copilot 双协议和 Bedrock 的关键映射正确。

这是 characterization fixture，不是新的生产模型注册中心。长期 Provider conformance fixture 应进一步按协议族拆分，避免单个目录承担 wire fixture 职责。

### 3.2 统一 AgentLoopLimits

新增公共类型 `AgentLoopLimits`：

| 字段 | 默认值 | 计数语义 |
| --- | ---: | --- |
| `maxModelCalls` | 100 | 单次 run 内所有模型调用，包括恢复与 continuation |
| `maxToolCalls` | 1000 | 单次 run 内模型返回的累计 tool call 数量 |
| `contextCheckpointTimeoutMs` | 300000 | 单个 checkpoint 最长未完成时间 |

默认值保守，目的是防止永久运行而不是限制正常对话。所有覆盖值必须是正安全整数；不允许用 `0` 隐式关闭有限执行契约。

新增 `AgentLoopLimitError`：

- 稳定错误码 `AGENT_LOOP_LIMIT_EXCEEDED`。
- `kind` 区分 `model_calls` / `tool_calls`。
- 保留 `limit` 和第一次超限的 `observed`。

预算在超额动作之前检查：

- 模型预算在下一次调用模型前检查。
- 工具预算在执行当前响应中的任一工具前检查。
- iterator 和 `result()` 通过 Phase 0A 的 EventStream 失败契约拒绝同一错误。

### 3.3 checkpoint timeout 与 abort

`requestContextCheckpoint()` 新增显式 options：

- `timeoutMs` 到期后以 `AgentContextCheckpointTimeoutError` 为 cause 结束 checkpoint。
- `signal` 已取消或后续取消时立即结束 checkpoint。
- 所有 settlement 路径统一清理 timer 和 abort listener。
- `complete()` / `fail()` 保持幂等，迟到的宿主响应不会二次 settlement。

当前 `AgentContextCheckpointFailure` 仍遵循 legacy 行为：Agent loop 发出 `agent_end` 并 resolve 已产生的消息，而不是将宿主持久化失败暴露为 run rejection。该行为本阶段只做 characterization，不代表 Phase 4 的最终错误语义。

### 3.4 上游配置贯通

- `AgentOptions.limits` 传入每次 standalone prompt 的 `AgentLoopConfig`。
- `AgentCoreTurnEngineOptions.limits` 传入 Runtime 的 Agent loop config。
- 根导出公开 limits 类型、默认值与错误类。

没有把 budget 复制到 Runtime 自有类型中，避免两个包维护不一致的默认值和字段含义。

## 4. TypeBox、Zod 与内部校验决策

本阶段没有为 `AgentLoopLimits` 引入 TypeBox 或 Zod，原因如下：

- 它是进程内 TypeScript 配置，不是 JSON、IPC、网络或持久化边界。
- 需要的运行时规则只有“正安全整数”，三个字段用一个小型纯函数即可完整表达。
- 为内部对象再维护 schema 会增加类型和默认值的双重来源。

采用方式：

- TypeScript interface 负责静态类型。
- `resolveAgentLoopLimits()` 负责默认值和最小运行时业务校验。
- 表驱动单测覆盖所有字段的非法值。

如果未来 limits 进入 `models.json`、Desktop IPC 或远程配置，再在那个外部边界用 TypeBox 定义单一 schema，并由 schema 推导静态类型；不在 Agent 内部增加 Zod 副本。TypeBox 仍继续用于工具输入 JSON Schema，这是它合适的边界。

## 5. 修改前测试证据

先加入 4 个端到端测试，修改前结果为 4/4 失败：

| 场景 | 修改前结果 |
| --- | --- |
| 宿主不完成 model-call checkpoint | `result()` 在 100ms 契约超时内不 settlement |
| checkpoint 等待中 abort | AbortSignal 不解除等待，仍超时 |
| 配置 `maxModelCalls: 2` | 配置被忽略，实际完成 3 次模型调用并成功结束 |
| 两个 tool calls、配置 `maxToolCalls: 1` | 两个工具都被执行，Agent 成功结束 |

测试中的 legacy fallback 都会主动结束，不会为了证明无限循环而制造永久运行的 Vitest 进程。

## 6. 测试覆盖

### 6.1 模型 fixture

- fixture 安装与非空 Provider。
- 五类关键 Provider/API 映射。
- 原 `supports-xhigh`、Bedrock 目录、Zen suite 定义和 cache-retention 测试。
- AI 包全量测试收集。

### 6.2 limits 纯函数

- 全部默认值。
- 单字段覆盖不影响其他默认值。
- `0`、负数、小数、非安全整数的表驱动拒绝。
- 等于 limit 不失败，第一次超限携带稳定结构化字段。

### 6.3 Agent 功能路径

- checkpoint timeout。
- checkpoint abort。
- 连续 tool loop 的模型调用预算。
- 单次响应批量工具调用预算。
- 预算错误在 iterator/result 两条通道一致。
- 超限前不调用模型或工具。
- 原有正常 loop、continue、checkpoint recovery、工具和 abort 行为回归。

### 6.4 上游集成

- Runtime AgentCore turn-engine 集成套件验证 adapter 兼容。
- 全仓类型检查验证 AgentOptions、AgentCoreTurnEngineOptions 及所有消费者。

## 7. 验证结果

| 范围 | 结果 |
| --- | --- |
| 模型 fixture + 原失败用例 | 17 通过，5 按凭据跳过，0 失败 |
| `packages/ai` 全量 | 85 通过，528 按凭据跳过，0 失败 |
| Agent limits 纯函数 + 端到端 | 11/11 通过 |
| Agent loop failure/normal/continue/limits | 22/22 通过 |
| `packages/agent` 全量 | 64 通过，43 按凭据/环境跳过，0 失败 |
| Runtime AgentCore turn-engine | 15/15 通过 |
| 根 `bun run check:quick` | 通过 |
| 根 `bun run check` | 通过；lint、根/CLI/Desktop/Admin/Docs 类型检查及全部架构守卫无错误 |

## 8. 预期与实际对比

| 项目 | 预期 | 实际 | 判断 |
| --- | --- | --- | --- |
| 生产模型架构 | 不恢复内置目录 | fixture 完全位于 `test/` | 达成 |
| AI deterministic 基线 | 无凭据可收集并全绿 | 85 通过、0 失败 | 达成 |
| checkpoint 有限结束 | timeout/abort 均可解除 | 端到端短超时测试通过 | 达成 |
| loop 有限执行 | 模型和工具均有预算 | 默认值、覆盖、错误结构均已测试 | 达成 |
| 上游可配置 | Agent 与 Runtime 可传递 | 两个 options 均已贯通并通过全仓类型检查 | 达成 |
| 测试分类 | unit/integration/live 物理隔离 | 当前仍由单一 `bun run test` 收集，依靠 skip 条件 | 未达成，进入 Phase 0C |

## 9. 已完成与未完成

已完成：

- AI 测试不再依赖已删除的生产内置模型目录。
- AI 与 Agent 包在无凭据环境下全量命令无失败。
- checkpoint timeout/abort 有限结束。
- 模型和工具累计调用预算及稳定错误。
- standalone Agent 与 Runtime adapter 配置贯通。
- 纯函数、端到端、包级、上游集成和全仓门禁验证。

未完成：

- 将 AI 测试物理拆成 deterministic、credential-gated integration、live canary。
- canonical message/event/result normalizer。
- legacy characterization report 和后续差分测试入口。
- 非协作的任意外部 hook/tool promise 的统一 deadline；当前只保证 checkpoint 和循环次数有限。
- Phase 4 对双向 event checkpoint 的最终替换及失败语义重定。
- Provider conformance suite 的协议族 model fixtures；当前目录只服务 legacy 测试基线。

因此 Phase 0B 的核心实现完成，但整个 Phase 0 仍未完成。

## 10. 涉及文件

AI 测试基础设施：

- `packages/ai/vitest.config.ts`
- `packages/ai/test/setup.ts`
- `packages/ai/test/fixtures/model-catalog.ts`
- `packages/ai/test/model-fixtures.test.ts`

Agent 有限执行：

- `packages/agent/src/types.ts`
- `packages/agent/src/loop/limits.ts`
- `packages/agent/src/loop/context-checkpoint.ts`
- `packages/agent/src/loop/assistant-stream.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/index.ts`
- `packages/agent/test/agent-loop-limit-config.test.ts`
- `packages/agent/test/agent-loop-limits.test.ts`

上游与记录：

- `packages/runtime-core/src/kernel/agent-core-turn-engine.ts`
- `docs/ai/impl/README.md`
- `docs/ai/impl/01-phase-0b-fixtures-and-limits.md`

## 11. 下一步入口

Phase 0C 应聚焦测试语义和差分基线，不再继续扩展 limits：

1. 为 AI 测试增加明确的 suite 分类和独立命令，默认 deterministic 不收集 live 测试。
2. 建立 canonical message/event/result normalizer，去除 timestamp、流式 delta 分块等非语义差异。
3. 用现有 Agent/Provider 场景生成 legacy characterization report。
4. 为后续 Phase 1 protocol 和 Phase 2 Provider adapter 建立新旧差分测试入口。
