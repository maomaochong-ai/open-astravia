# 测试与质量门禁方案

## 1. 测试目标

重构测试必须回答三类问题：

1. 规范化协议是否稳定？
2. 每个 Provider 是否实现同一组可观察语义？
3. Agent 与 Runtime 重构前后的 Session 行为是否等价？

测试数量不是目标。默认测试必须无真实凭据、无公网、可重复，并在失败时指出是哪一层契约破坏。

## 2. 从 Vercel 借鉴什么

### 借鉴

- Mock Language Model：脚本化返回值，同时记录每次调用参数。
- 可控 ReadableStream：精确测试 delta、延迟、abort、半截 JSON 和异常终止。
- 统一 Test Server 思想：用同一套 transport fixture 表达 JSON、stream、empty、HTTP error 和 controlled stream。
- Provider wire fixture：既断言请求，也断言响应转换。
- `*.test-d.ts`：类型 API 与运行时测试分离。
- Node/Edge 配置分离：兼容性声明由测试证明。

### 不照搬

- 不复制超大 Agent generate/stream 对称用例；同一场景通过参数化 harness 跑不同消费方式。
- 不用大型 snapshot 保护内部实现对象。
- 不让所有包全量 Node/Edge 双跑。
- 不在默认套件调用真实 Provider。

## 3. 测试分层

### L0 类型契约

位置建议：`packages/*/test-d/` 或遵循 Vitest typecheck 的 `*.test-d.ts`。

覆盖：

- Tool schema 推导 execute input。
- Api 与 options map 的穷尽映射。
- Stream event switch 的穷尽性。
- Registry registration 与 Provider 特定选项。
- 公共入口不泄漏内部类型。

类型退化必须让 CI 失败，不能依赖 IDE 人工发现。

### L1 纯函数与协议状态机

覆盖：

- 消息转换、reasoning/tool replay、usage 归一化。
- SSE/JSON Lines 分帧、Unicode surrogate、tool-call id。
- Stream terminal law。
- 错误分类和 retry-after。
- TypeBox 入站校验和脱敏。
- Agent stop decision、queue policy、事件投影。

使用 table-driven cases，避免一个 Provider 一个复制文件。

### L2 Provider fixture tests

每个 Adapter 使用注入式 transport，不走公网：

- 断言 URL、method、headers、query、body。
- 断言正常 JSON/stream 转成规范事件。
- 断言真实脱敏 fixture 的兼容性。
- 断言错误 body、未知字段、缺字段和异常 chunk。
- 断言 abort signal 到达 transport，response body 被关闭。

优先实现轻量 `createProviderTestTransport`，使用原生 Request/Response/ReadableStream。只有需要验证 fetch 拦截器或跨模块网络行为时才引入 MSW；不因 Vercel 使用 MSW 就直接增加依赖。

### L3 Provider Conformance Suite

所有 Provider registration 自动进入共享矩阵：

| 能力 | 必测场景 |
| --- | --- |
| 文本 | 单块、多 delta、空文本、Unicode 边界 |
| reasoning | 支持、禁用、签名/加密字段保留 |
| tool | 单调用、多调用、参数分片、缺失参数、无结果历史 |
| usage | input/output/cache、缺失字段、总量一致性 |
| finish | stop、length、tool use、content filter、unknown raw reason |
| error | 401、403、429、400、500、无效 JSON、流中错误 |
| abort | 调用前、中途、完成后 abort |
| context | overflow 分类、最大窗口附近输入 |
| multimodal | 按 capability 测 image/file/tool result image |

能力不支持时 registration 必须声明，harness 验证返回 `AI_UNSUPPORTED_CAPABILITY`，不能简单 skip。只有外部环境缺失才允许 skip。

### L4 Agent Functional Suite

使用 `ScriptedLanguageModel` 和真实 Agent Engine，不 mock engine 内部函数：

- 纯文本一个 step 完成。
- 一次/多次/并行工具调用。
- 无效参数、未知工具、工具抛错、结构化工具错误。
- 工具执行期间 abort。
- 模型流中断、finish 缺失、assistant error recovery。
- checkpoint 成功、失败、请求 retry、调用方 abort。
- 动态工具在下一次 Model Call 可见，当前 Frame 不变化。
- steering 插入后跳过剩余工具，follow-up 在自然停止点继续。
- 无限 tool-use 被 maxModelCalls/maxToolCalls 终止。
- observer/callback 抛错不破坏核心执行，且产生可诊断 observation。
- `events` 和 `result` 在所有终态都有限结束。

### L5 Runtime 集成与差分测试

以 `TurnEnginePort` 为边界运行两套实现：legacy adapter 与新 engine。对同一 Scripted Model 场景比较 canonical outcome：

- 最终 conversation messages。
- 持久化 StoredSessionEvent 序列。
- TurnResult status/stopReason。
- tool execution 次数与授权请求。
- context checkpoint/compaction 提交。
- snapshot release 和 terminal event。

不比较时间戳、内部 delta 分组、临时对象 identity 等非语义字段。建立 canonicalizer 去除这些噪声，但 canonicalizer 本身必须有测试。

### L6 Host Port 与应用契约

- Runtime Session Port 的输入输出 schema。
- ContextCompositionReport 的 section 汇总、排序、未知 token 和 provider 校准值。
- Desktop IPC 只传可序列化数据。
- UI 只测试交互决定：展开、筛选、估算标识、无数据/过期报告；不快照整棵 React 树。
- CLI 与 Desktop 对相同 Runtime report 的总量解释一致。

### L7 Live Provider Canary

真实 Provider 测试单独放置并显式标记：

- 默认 `bun run test` 不执行。
- 手动或定时 CI 执行。
- 每个 Provider 只保留少量高价值 smoke：文本、tool、stream abort、usage。
- 记录 Provider/model/API 版本，失败归类为产品回归或外部漂移。
- 不能用 retry 掩盖确定性断言失败；只对已识别的瞬时网络错误重试。

现有 `abort.test.ts`、`empty.test.ts`、`image-tool-result.test.ts` 等真实 Provider 矩阵应逐步拆为 deterministic conformance + 少量 canary，而不是删除覆盖。

## 4. Stream 专项契约

每种 stream 实现必须通过以下 terminal cases：

| 场景 | events | result |
| --- | --- | --- |
| 正常 finish | 有且仅一个 finish | resolve |
| 正常 EOF 无 finish | iterator reject | reject protocol error |
| Provider error chunk | iterator reject | reject normalized error |
| parser throw | iterator reject | reject validation/protocol error |
| abort | 有限结束 | reject/resolve aborted result，规则唯一 |
| consumer 提前 return | transport cancel | 不留 pending promise |
| listener/observer throw | 被隔离并报告 | 核心 result 不受影响 |

需要使用短超时断言“会结束”，专门防止 pending promise 和悬挂 checkpoint 回归。

## 5. Context Composition 专项测试

- base instruction、每个 skill、每个 tool schema、history、runtime context、user input 各自形成 section。
- 相同 sourceId 聚合规则稳定，不同 skill 不误合并。
- Frame finalizer 删除/追加消息后，报告对应最终 Frame。
- 所有 section 可估算时，estimated total 等于 sections 之和；存在未知项时 total 为 `null`，knownTokens 等于已知项之和。
- provider-reported input tokens 不等于 estimate 时两者同时保留，不按比例伪造精确分项。
- 模型切换后 context window 和 tokenizer 版本更新。
- compaction 前后报告可比较，removed/replaced section 有明确来源。
- 敏感 prompt 默认不进入报告，只存 token/character/hash 等元数据。

## 6. CI 门禁建议

快速反馈：

```bash
bunx vitest --run <changed-test-files>
bun run check:quick
```

包级门禁：

```bash
bun run test
```

分别在 `packages/ai`、`packages/agent`、`packages/runtime-core` 执行其 package test script。完成一轮代码改动后再执行根：

```bash
bun run check
```

新增建议脚本名称：

- `test:unit`
- `test:contract`
- `test:provider-fixtures`
- `test:conformance`
- `test:differential`
- `test:canary`（非默认）

脚本拆分要服务于失败定位和 CI 并行，不能让同一测试被多个默认脚本重复执行。

## 7. 重构阶段退出标准

任何旧实现只能在以下条件全部满足后删除：

- 新旧差分场景全部一致，差异均有书面决策。
- 所有 Provider 完成 deterministic conformance。
- 失败、abort、partial stream、checkpoint 等负路径有测试。
- 公共类型测试通过。
- 上游没有新的 compat API 调用。
- 至少一个稳定周期的 canary 未发现新实现特有回归。
