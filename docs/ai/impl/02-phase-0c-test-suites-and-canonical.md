# Phase 0C：测试分层与 Canonical Characterization

## 1. 阶段目标

本阶段解决两个基础问题：

1. 默认测试命令不能依赖真实 Provider 凭据，也不能用大量 `skip` 制造“测试通过”的错觉。
2. 后续拆分 Provider Runtime、稳定协议和 Agent Engine 时，需要一套忽略非语义差异、保留行为契约的 characterization 表示。

本阶段不迁移 Provider，不改变消息协议，不引入 schema 库，也不修改运行时业务行为。

## 2. Vercel AI 对照与取舍

Vercel AI 仓库的 Provider 测试大量使用受控 mock server、录制响应、Provider fixture 和面向公开函数的功能测试。这一方向值得采用，因为它把“网络是否可用”与“协议转换是否正确”分开，并能覆盖流分片、错误响应、工具调用等真实协议形态。

但不能直接照搬以下做法：

- Provider 各自维护断言时，跨 Provider 的等价行为仍可能漂移。
- 快照如果保留时间戳、耗时或原始 delta 分片，会放大无意义差异。
- 只验证最终文本会漏掉 usage、stop reason、tool call、错误和生命周期契约。

因此本仓库采用两层策略：

- Phase 0C 先建立跨实现的 canonical 结果，作为迁移前后的等价判定。
- Phase 2 再建立受控传输层和 Provider contract suite，吸收 Vercel AI 的 mock transport 优点。

这不是认定 Vercel AI 的测试结构天然最优，而是复用其“受控协议输入”的有效部分，并补上跨 Provider、跨 Agent 实现的一致性判定。

## 3. 测试套件物理分层

### 3.1 `packages/ai`

新增四类入口：

| 命令 | 范围 | 是否允许凭据依赖 | 本阶段结果 |
| --- | --- | --- | --- |
| `bun run test` / `test:unit` | 纯单元与受控 fixture | 否 | 24 files，80 passed，0 skipped |
| `bun run test:integration` | 较慢的传输/缓存集成测试 | 可包含显式条件 | 1 file，7 passed，4 skipped |
| `bun run test:live` | 真实 Provider | 是 | 16 files，524 skipped（无凭据环境） |
| `bun run test:all` | unit + integration + live | 是 | 25 passed files，16 skipped files；87 passed，528 skipped |

文件归类集中在 `packages/ai/vitest.suites.ts`，避免每个配置维护不同的隐式 glob。默认配置显式排除 integration 和 live 文件。

`cache-retention.test.ts` 暂归 integration，因为它仍含模拟网络与 4 条真实凭据条件分支。Phase 2 应将其中可确定的协议行为迁移到受控 transport，使 integration 套件也尽量达到 0 skip。

### 3.2 `packages/agent`

原 `e2e.test.ts` 同时包含 42 条真实 Provider 用例和 2 条 `Agent.continue()` 纯校验用例。后者迁移到 `agent-continue-validation.test.ts` 后，E2E 文件可以整体归入 live 套件。

| 命令 | 范围 | 本阶段结果 |
| --- | --- | --- |
| `bun run test` / `test:unit` | 纯单元、受控流与 Agent loop 测试 | 13 files，65 passed，0 skipped |
| `bun run test:live` | Provider E2E 与 Bedrock extensive models | 2 files，43 skipped（无凭据环境） |
| `bun run test:all` | unit + live | 13 passed files，2 skipped files；65 passed，43 skipped |

第一次实现使用 `mergeConfig(baseConfig, override)`。Vitest 对数组配置执行合并，`test:live` 实际仍运行默认单元套件，未达到物理隔离目标。修正为共享基础字段、每个配置显式声明 `include` 后，live 入口只收集两个目标文件。该偏差已通过实际运行发现，不能仅凭配置代码推断分层成功。

## 4. Canonical Characterization

### 4.1 AI 公共 testkit

新增 `@vetta/ai/testkit` 子路径，提供：

- `canonicalizeAssistantMessage()`：规范最终 Assistant 消息。
- `canonicalizeAssistantRun()`：规范一次流式运行的结果与事件。
- `canonicalizeJsonValue()`：递归稳定 JSON 对象键顺序。

规范化规则：

- 移除消息 `timestamp`。
- 对工具参数中的 JSON 对象键递归排序。
- 按 `contentIndex` 聚合 text、thinking 和 tool-call argument delta。
- 忽略等价流在 delta 切块边界上的差异。
- 保留非 delta 生命周期事件、usage、stop reason、错误、工具名与工具调用 ID。

AI 级 normalizer 是公开 testkit，而不是运行时 API。Provider package、生态适配器和迁移测试可以复用它，但生产代码不应依赖该子路径。

### 4.2 Agent 测试侧 normalizer

Agent 的 canonical 表示保留：

- Agent 生命周期顺序。
- checkpoint 原因与恢复结果。
- 工具结束事件的语义字段。
- phases 标签。
- 最终消息序列。

它忽略：

- message/tool update 的原始切块。
- 工具与 phase 的耗时。
- 消息时间戳。

Agent normalizer 当前只位于 `test/support`，不作为公共 API。原因是 Agent 事件协议仍将在 Phase 4 重构；过早公开会把 characterization 形状误当成稳定运行时契约。

## 5. TypeBox、Zod 决策

本阶段不引入 Zod，也不扩大 TypeBox 使用范围。

canonicalization 处理的是仓库内部强类型对象，不是外部不可信输入；用 schema 库会增加重复定义和运行时成本，却不能提升等价判定本身。Phase 1/2 只应在 JSON 边界、持久化边界或 Provider 外部输入需要运行时校验时评估 TypeBox。由于 Agent 已依赖 TypeBox，若确有 schema 需求，应优先复用 TypeBox，避免双 schema 栈。

## 6. 类型解析偏差

AI testkit 子路径加入 package export 后，包内测试可运行，但根 TypeScript 检查首次失败：NodeNext 解析无法从 workspace 源码推导 `@vetta/ai/testkit`。

实际修复是在根 `tsconfig.json` 增加精确 path mapping：

```json
"@vetta/ai/testkit": ["./packages/ai/src/testkit/index.ts"]
```

不能只保留 `@vetta/ai/*` 泛型映射，因为现有 workspace path 结构与 package 子路径并非自然一一对应。该映射同时使 Agent 测试类型检查与 Vitest alias 保持一致。

## 7. 测试证据

本阶段最终验证：

- AI unit：80 passed，0 skipped。
- AI integration：7 passed，4 skipped。
- AI live（无凭据）：524 skipped，未误计为通过。
- AI all：87 passed，528 skipped。
- Agent unit：65 passed，0 skipped。
- Agent live（无凭据）：43 skipped，未误计为通过。
- Agent all：65 passed，43 skipped。
- `bun run check:quick`：通过。
- `bun run check`：通过，包括 Biome、root/CLI/Desktop/Admin/Docs 类型检查和全部 guards。

## 8. 预期与实际

| 项目 | 预期 | 实际 | 处理 |
| --- | --- | --- | --- |
| 默认测试 | 无凭据、无 skip | AI 与 Agent 均达到 | 完成 |
| live 测试 | 只收集真实 Provider 用例 | AI 达到；Agent 首次未达到、修正后达到 | 完成 |
| canonical | 忽略时间和切块，保留语义 | AI 与 Agent characterization 均覆盖 | 完成 |
| schema | 边界需要时才引入 | 本阶段没有运行时边界需求 | 不引入 |
| integration | 尽可能无 skip | AI 缓存测试仍有 4 条凭据分支 | Phase 2 继续处理 |

## 9. 已完成与未完成

已完成：

- AI、Agent 默认/live/all 测试入口物理分层。
- AI 单独的 integration 入口。
- AI 公共 canonical testkit 与 Agent 测试侧 normalizer。
- `Agent.continue()` 确定性校验从 E2E 迁出。
- 默认套件均达到 0 skip。
- Phase 0 的流终止、有限执行、测试基线和 characterization 退出条件。

未完成：

- 受控 Provider transport 与统一 contract suite，属于 Phase 2。
- 将 cache retention 中可确定的凭据分支改成无网络测试，属于 Phase 2。
- 将 canonical run 应用于每个 Provider 的迁移前后对照，属于 Phase 3。
- Agent 公共事件协议定型，属于 Phase 4。

## 10. 涉及文件

AI：

- `packages/ai/vitest.suites.ts`
- `packages/ai/vitest.config.ts`
- `packages/ai/vitest.integration.config.ts`
- `packages/ai/vitest.live.config.ts`
- `packages/ai/vitest.all.config.ts`
- `packages/ai/src/testkit/index.ts`
- `packages/ai/src/testkit/canonical-assistant-run.ts`
- `packages/ai/test/canonical-assistant-run.test.ts`
- `packages/ai/package.json`
- `tsconfig.json`

Agent：

- `packages/agent/vitest.suites.ts`
- `packages/agent/vitest.config.ts`
- `packages/agent/vitest.live.config.ts`
- `packages/agent/vitest.all.config.ts`
- `packages/agent/test/agent-continue-validation.test.ts`
- `packages/agent/test/e2e.test.ts`
- `packages/agent/test/support/canonical-agent-run.ts`
- `packages/agent/test/canonical-agent-run.test.ts`
- `packages/agent/package.json`
