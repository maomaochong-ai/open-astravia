# Phase 2：Provider Runtime 与测试基础设施

## 阶段结论

Phase 2 的代码目标已经实现：新的调用语义、隔离注册表、测试模型、可控 transport、两个试点 Provider、TypeBox 入站校验和确定性 conformance 均已落地。试点 live canary 因当前环境没有 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 或 `ANTHROPIC_OAUTH_TOKEN`，仍是待验项，不能记作通过。

本阶段没有直接替换现有 `stream()`。旧公共 API 继续通过显式命名的 `LegacyApiProviderRegistry` 工作，新代码使用 `LanguageModelAdapter` 和 `AdapterRegistry`。这条双轨只有迁移用途；Phase 3 应逐批把生产 provider 移到新语义，Phase 7 删除兼容注册表。

## 实现范围

### 1. 新旧调用语义分离

新增 `runtime/language-model-adapter.ts`：

- `LanguageModelAdapter` 描述单次 Provider 中立模型调用。
- `LanguageModelStream` 只允许成功 `done` 事件作为终态。
- `adaptApiProvider()` 将旧 `ApiProvider` 投影到新调用语义。
- 旧 `error` 终止事件不再进入新事件流，而是让异步迭代器和 `result()` 同时 reject。
- abort、context overflow、普通 Provider 错误和底层异常分别归一到稳定 `AIError.code`。

原 `AdapterRegistry` 改为只注册新 adapter；旧注册逻辑重命名为 `LegacyApiProviderRegistry`。两个注册表都支持实例隔离、重复注册拒绝、显式替换和按来源卸载。全局 `registerApiProvider()` 仅保留在兼容入口。

这个拆分避免了“新注册表实际仍保存旧 provider”的伪迁移，也使后续 provider 可以逐个切换而不改变旧调用方。

### 2. 可注入 transport

`StreamOptions` 新增标准 `fetch` 注入点，并贯通 OpenAI Completions 与 Anthropic 客户端。`@vetta/ai/testing` 提供：

- JSON response。
- HTTP error response。
- 静态 SSE。
- 空 SSE。
- 可控 SSE。
- 请求 URL、method、headers 和 body 捕获。
- transport 脚本耗尽与 abort 的结构化失败。

测试不依赖 MSW。当前需求只需要单请求边界和受控流，原生 `Request`、`Response`、`ReadableStream` 更小、更直接；当未来需要验证 Service Worker 拦截或跨模块网络拓扑时再评估 MSW。

### 3. ScriptedLanguageModel

新增按调用顺序执行的脚本模型，支持：

- 预置成功事件与结果。
- 预置结构化失败。
- 调用记录与顺序断言。
- 脚本耗尽错误。
- 调用前 abort。

该工具通过 `@vetta/ai/testing` 条件子路径导出，不从生产根入口导出。Phase 4 Agent Functional Suite 和 Phase 5 runtime differential tests 应复用它，不再 mock engine 内部函数。

### 4. Provider 试点与 Conformance

选择了两种不同复杂度的试点：

- OpenAI Chat Completions：通用 HTTP/SSE、分片 tool arguments、usage 尾帧。
- Anthropic Messages：SDK 驱动的事件状态机、content block 生命周期、thinking/tool 复合事件。

共享数据驱动矩阵覆盖：

- 文本 delta、usage 和成功终态。
- tool arguments 分片与 `toolUse`。
- HTTP 错误兼容终态。
- context overflow 分类。
- 畸形 wire payload。
- HTTP 200 但无任何 Provider 事件的空流。
- 调用前 abort。

测试首先暴露出两个既有差异：OpenAI 将空 200 SSE 当作成功，Anthropic SDK 抛出私有空流异常。现在两者统一为稳定的空流协议错误。Anthropic 畸形载荷测试还区分了 SDK 状态机错误与 TypeBox 边界错误，避免用乱序事件冒充 schema 测试。

### 5. TypeBox 与 Zod 决策

本阶段使用 TypeBox，不引入 Zod：

- 仓库工具 schema 与公共类型已经以 TypeBox 为事实标准。
- TypeBox schema 同时提供静态类型与运行时 `Value.Check`，适合 Provider wire 边界。
- 再引入 Zod 会形成两套 schema、两套错误格式和额外转换层，不能改善当前所有权问题。

校验放在 SDK/transport 产出的未知数据进入内部事件转换之前，并映射为 `AI_RESPONSE_VALIDATION_FAILED`。schema 当前只约束转换器真正依赖的字段并允许未知字段，避免 Provider 增字段导致无意义破坏。后续迁移不得用完整上游响应的机械镜像取代边界最小 schema。

## 与 Vercel AI 的取舍

参考 Vercel AI 的价值在于 provider-utils、注入 transport、共享 conformance 和功能级 fixture，而不是复制其包数量或抽象层数。本阶段采用了相同的“协议契约 + provider fixture + 共享测试”方向，但保留以下差异：

- 不为了测试统一直接引入 MSW，当前原生 Web transport 足够。
- 不让测试 harness 成为生产根 API。
- 不把每个 Provider 强制拆成相同数量的空文件，按真实职责拆分。
- 不接受同时使用 error event 和 rejected result 的双失败通道。
- 不把上游 SDK 类型断言当运行时校验。

Vercel 的实现是重要参照，不是目标架构的证明。是否采用某个模式仍以本仓库的依赖方向、错误语义和迁移成本为准。

## 测试证据

定向验证：

```text
bunx vitest --run test/adapter-registry.test.ts test/language-model-adapter.test.ts
  test/provider-conformance.test.ts test/wire-validation.test.ts
  test/scripted-language-model.test.ts test/provider-test-transport.test.ts
结果：6 files，37 tests，通过，0 skip
```

包级验证：

```text
packages/ai: bun run test
结果：31 files，124 tests，通过，0 skip

packages/ai: bunx tsgo --noEmit
结果：通过

root: bun run check:quick
结果：通过
```

live canary：

```text
OPENAI_API_KEY=False
ANTHROPIC_API_KEY=False
ANTHROPIC_OAUTH_TOKEN=False
结果：未运行；待具备凭据后执行试点 text/tool/abort/usage canary
```

## 退出条件核对

| 条件 | 状态 | 说明 |
| --- | --- | --- |
| fixture + conformance | 通过 | 两个试点共 14 个共享场景 |
| live canary | 待验 | 当前环境无凭据 |
| 新增 Provider 无需修改中心 switch | 通过 | registry 解析；仍需在 builtins composition 注册 |
| 无网络覆盖 text/tool/usage/error/abort/overflow | 通过 | 原生 test transport |
| Provider 入站 TypeBox 校验 | 试点完成 | Phase 3 逐批扩展 |
| 新错误语义 | 通过 | iterator 与 result 同源 reject |

## 后续约束

- Phase 3 新迁移代码不得注册到 `LegacyApiProviderRegistry`。
- 每批 Provider 必须先补最小 wire schema 和 deterministic fixture，再切生产分发。
- Provider SDK 先于本地 schema 抛出的错误必须映射为稳定错误码，不能依赖 SDK message 做上游业务判断。
- 兼容层不得新增能力；发现旧语义缺陷时优先在 adapter 投影层归一。
- live canary 具备凭据后补跑并更新本记录，不得用 deterministic 测试替代外部漂移验证。

## 主要文件

- `packages/ai/src/runtime/language-model-adapter.ts`
- `packages/ai/src/runtime/adapter-registry.ts`
- `packages/ai/src/testing/scripted-language-model.ts`
- `packages/ai/src/testing/provider-test-transport.ts`
- `packages/ai/src/provider-kit/stream-errors.ts`
- `packages/ai/src/provider-kit/wire-validation.ts`
- `packages/ai/src/providers/openai-completions/response-schema.ts`
- `packages/ai/src/providers/anthropic/response-schema.ts`
- `packages/ai/test/provider-conformance.test.ts`
- `packages/ai/test/language-model-adapter.test.ts`
