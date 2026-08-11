# Phase 3A：OpenAI-compatible 原生 Adapter

## 阶段目标

把 OpenAI Completions 及其兼容变体从“新 Registry 包装旧 stream function”迁移为真正由 `LanguageModelAdapter` 所有的协议实现，同时保持现有 `stream*()` 公共 API 和结果语义不变。

本批覆盖 6 个 API：

- `openai-completions`
- `nvidia-openai-responses`
- `qwen-openai-completions`
- `openai-completions-deepseek`
- `zai-openai-completions`
- `zhipu-openai-completions`

本批不迁移 Responses、Anthropic、Google 和 Bedrock 协议族，也不移除 legacy API。

## 修改前状态

- 六个 API 都能出现在 `AdapterRegistry`，但实际由 `adaptApiProvider()` 把旧 `AssistantMessageEventStream` 转成新失败语义。
- OpenAI Completions 已有 request builder、TypeBox chunk schema 和可注入 transport，但流解析及终止所有权仍在旧入口。
- 变体通过把模型 API 改写为 `openai-completions` 复用旧实现；Registry 无法辨别这是原生实现还是兼容桥。
- Provider 抛错归一化位于 `runtime/legacy-error-classifier.ts`，原生实现若直接复用会形成新层反向依赖旧层。

## 已实现

### 协议族 Adapter

- 新增 `createOpenAICompatibleAdapter()`，集中拥有请求创建、SSE chunk 校验、文本/思考/tool-call 归约、usage 计算、终止和失败处理。
- `openAICompletionsAdapter` 直接使用该实现。
- NVIDIA、Qwen、DeepSeek、Z.ai 与智谱分别导出原生 Adapter，只做不可变模型映射；请求差异继续由现有 `compat.thinkingFormat` 等配置表达。
- `registerBuiltInAdapters()` 对这 6 个 API 注册原生 Adapter；其余 8 个 API 明确回退到 `adaptApiProvider()`。

### 兼容边界

- 旧 `streamOpenAICompletions()` 改为消费原生 Adapter，并把 rejection 映射回旧 `error` terminal event。
- 变体旧入口继续复用这个兼容投影，因此调用方无需在本阶段同步迁移。
- 结果消息的 `api` 仍为底层 `openai-completions`，与迁移前模型映射行为一致；家族测试将其固定为兼容契约。

### 失败与取消

- 新 Runtime 路径只有一个失败通道：事件迭代器与 `result` Promise 均 reject，同一个错误不再伪装成成功结果。
- 空 provider stream 映射为 `AI_STREAM_PROTOCOL_FAILED`。
- wire schema 失败映射为 `AI_RESPONSE_VALIDATION_FAILED`。
- HTTP 401/403/4xx/429/5xx 和 context overflow 通过 `provider-kit/normalizeProviderError()` 转成结构化 `AIError`。
- 调用前 abort 和流中 abort 都落为 `AI_ABORTED`；测试 transport 暴露实际 request signal，以验证取消确实传播到 HTTP 边界。
- `normalizeLegacyProviderError()` 仅保留为 legacy bridge 的兼容别名，原生 Adapter 不再导入 legacy classifier。

## 设计模式与所有权

- **Adapter Pattern**：Provider wire/API 差异被收敛到 `LanguageModelAdapter`，上层只消费统一事件和结构化错误。
- **Protocol Family Factory**：同一 wire 协议共享 parser，不为每个品牌复制实现；变体只提供 `Model<TApi> -> Model<"openai-completions">` 映射。
- **Anti-corruption Layer**：legacy `stream*()` 是从新契约到旧 error-event 语义的单向投影，新实现不依赖旧终止模型。
- **Single Ownership**：request builder、wire schema、stream reducer 和错误 normalizer 各有唯一归属，Registry 只负责选择，不包含协议逻辑。

没有为内部已类型化对象增加 TypeBox。TypeBox 继续只验证 Provider 返回的未知 wire payload；六个 API 共用同一 OpenAI chunk schema，因为它们共用协议，而不是因为它们共用品牌。

## 测试

新增 `openai-compatible-adapters.test.ts` 的 18 条家族级测试：

- 六个 API 均通过默认 `AdapterRegistry` 完成文本、usage 与事件序列。
- 六个 API 均保持工具 schema、参数分片和 `toolUse` 终止语义。
- 分别断言 OpenAI、NVIDIA、Qwen、DeepSeek、Z.ai、智谱的 reasoning request payload。
- 畸形 wire、空流、429、调用前 abort、流中 abort 均断言结构化错误代码。
- legacy Qwen 入口仍断言 `error` terminal event，证明兼容投影未丢失。

新增 `provider-error.test.ts` 的 8 条表驱动测试，覆盖 HTTP 状态映射、retryable、context overflow 优先级、已有 `AIError` 保真和无状态码 transport failure。

验证结果：

- 直接相关测试：3 个测试文件、36 条测试通过。
- `packages/ai` 全量：34 个测试文件、158 条测试通过，0 失败。
- `bun run check:quick`：通过。
- 根 `bun run check`：lint、root/CLI/desktop/admin/docs 类型检查及全部 guards 通过。
- live canary：未运行，当前环境无 Provider 凭据；不能以离线结果替代真实服务验证。

## 预期与实际

预期是先迁移 OpenAI-compatible 的 request/parser，再获得六个 API 的原生注册。实际达成与预期一致，并额外消除了原生 Adapter 对 legacy error classifier 的反向依赖。

测试 429 时发现 OpenAI SDK 会在 Adapter 内部自动重试：只提供一次 429 后，后续无 fixture 请求最终表现为连接错误，会掩盖原始 rate-limit。测试改为提供三次带 `retry-after: 0` 的 429 响应，匹配当前 SDK 尝试次数，并确认最终保留 `AI_RATE_LIMITED`、`statusCode: 429`、`retryable: true`。这不是理想的长期所有权；统一 retry policy 仍应在后续上移到 Runtime。

原计划只列 DeepSeek、Qwen、Z.ai 与智谱，实际同时纳入 NVIDIA，因为它使用相同 OpenAI Completions wire 协议和 parser，只在 thinking payload 上存在配置差异。纳入同一批比继续走 legacy bridge 更符合协议族边界。

## 尚未完成

- 8 个非本协议族 API 仍通过 legacy bridge。
- SDK 重试仍不可由 Runtime 统一观测、预算和报告。
- live canary 尚未验证真实服务的 header、代理、流关闭和限流响应。
- legacy `stream*()` 仍是公共兼容面；删除必须等待调用方迁移和既定兼容周期。

## 涉及文件

- `packages/ai/src/providers/openai-completions/adapter.ts`
- `packages/ai/src/providers/openai-completions/stream.ts`
- `packages/ai/src/providers/openai-completions.ts`
- `packages/ai/src/providers/{deepseek,nvidia,qwen,zai,zhipu}.ts`
- `packages/ai/src/providers/register-builtins.ts`
- `packages/ai/src/provider-kit/provider-error.ts`
- `packages/ai/src/runtime/legacy-error-classifier.ts`
- `packages/ai/src/testing/provider-test-transport.ts`
- `packages/ai/test/openai-compatible-adapters.test.ts`
- `packages/ai/test/provider-error.test.ts`

## 下一入口

下一批优先迁移 OpenAI Responses、Azure Responses 和 Codex Responses。开始前先把三者的事件类型、认证/URL 差异、SSE 与 WebSocket 终止行为整理为协议族矩阵；共同 reducer 可以复用，认证和 endpoint 选择必须留在 transport/config 层，不能塞入事件 parser。
