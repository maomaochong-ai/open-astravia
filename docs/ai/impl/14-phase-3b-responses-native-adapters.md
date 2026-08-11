# Phase 3B：Responses 原生 Adapter

## 目标与范围

本阶段迁移三个使用 OpenAI Responses 事件模型的 API：

- `openai-responses`
- `azure-openai-responses`
- `openai-codex-responses`

完成标准不是“新 Registry 中可以调用”，而是三个 API 的 request、wire reducer、失败、取消和终止语义都不再经 `adaptApiProvider()`。旧 `stream*()` 公共入口继续保留，但只能从新 Adapter 单向投影到旧 error-event 语义。

本阶段不迁移 Anthropic、Google 或 Bedrock，不删除 legacy registry，也不把 retry policy 上移到 Runtime。

## 修改前问题

- 三个 API 在 `AdapterRegistry` 中实际仍由 `adaptApiProvider()` 包装旧 `AssistantMessageEventStream`。
- 共享 `processResponsesStream()` 只依赖 SDK TypeScript 类型，没有校验运行时 wire payload。
- reducer 用单一 `currentItem/currentBlock` 管理所有 output item；带 `output_index` 的交错 delta 可能写到错误 block。
- 空流、缺失 `response.completed` 和未闭合 output item 可落成正常 `done`。
- `response.incomplete` 没有作为独立 terminal 处理。
- Codex SSE/WebSocket 对畸形 JSON 使用空 `catch` 静默跳过。
- OpenAI/Azure 没有把 `StreamOptions.fetch` 传给 SDK，无法用受控 transport 做完整离线测试。
- Codex session cache 只设置 `session_id` 和 `prompt_cache_key`，缺少既有测试要求的 `conversation_id` 与 `prompt_cache_retention: "in-memory"`。

## 模块划分

| 模块 | 职责 |
| --- | --- |
| `openai-responses/response-schema.ts` | TypeBox wire schema、按事件类型的字段校验、JSON parse error 分类 |
| `openai-responses/events.ts` | Provider 中立的 Responses output-item 状态机、usage/cost 和 terminal 归约 |
| `openai-responses/adapter.ts` | 原生 Adapter 执行模板、OpenAI SDK 调用、统一 success/fail/abort settlement |
| `openai-responses/request.ts` | OpenAI client、request、cache/reasoning/service-tier 映射 |
| `openai-responses/legacy-stream.ts` | 从原生 Adapter rejection 到旧 `error` event 的单向兼容投影 |
| `azure-openai-responses/{adapter,request,options}.ts` | Azure endpoint、API version、deployment、认证和 request 映射 |
| `openai-codex/adapter.ts` | Codex JWT/header、SSE/WebSocket 选择与原生 Adapter 接入 |
| `openai-codex/{events,websocket,request}.ts` | Codex 帧规范化、连接生命周期、HTTP retry 与 session cache |

三个顶层 Provider 文件现在是薄 facade：导出 options/adapter，并保留 legacy `stream`/`streamSimple`。事件 parser 不知道 API key、Azure resource 或 Codex JWT；transport 不拥有消息归约。

## Responses 状态机

reducer 以 `Map<output_index, ItemState>` 管理 reasoning、message 和 function call：

1. `response.output_item.added` 创建 block，并记录稳定的 content index。
2. delta 根据 `output_index` 定位 block；缺失 index 时只对 Codex 旧帧使用当前 item fallback。
3. `response.output_item.done` 校验 item 类型未变化，完成 block 并删除状态。
4. `response.completed` 或 `response.incomplete` 到达时，必须没有未闭合 item。
5. terminal 后再有事件、delta 先于 item、item 类型变化、空流或 EOF 无 terminal 都抛 `AI_STREAM_PROTOCOL_FAILED`。

这使交错 text/tool delta 可以正确归约，也避免把截断 provider stream 当作成功消息。

## TypeBox 与类型边界

本阶段继续采用方案中的 TypeBox 策略：

- TypeBox 校验 Provider 返回的未知事件、关键 item、content part、usage 和 terminal 字段。
- JSON 语法错误直接分类为 `AI_RESPONSE_VALIDATION_FAILED`。
- 对未消费但合法扩展的 Responses event，只要求存在字符串 `type`，避免 SDK 新增观察事件时无故破坏调用。
- 内部 request、状态机和协议对象继续使用 TypeScript 类型，不引入 Zod，也不做重复运行时校验。

动态按事件类型选择 schema，避免一个宽松 union fallback 让畸形已知事件绕过校验。

## Transport 与兼容边界

### OpenAI

- OpenAI SDK client 接收 `options.fetch`，保留 gateway、Copilot dynamic headers、cache retention、reasoning 和 service-tier pricing。
- SDK stream 直接进入共享 reducer。

### Azure

- Azure resource/base URL、API version 和 deployment name 留在 Azure request 模块。
- Azure SDK 同样接收 `options.fetch`；事件归约不包含 Azure 分支。

### Codex

- SSE 与 WebSocket 都先规范化为 Responses events，再进入共享 reducer。
- WebSocket session cache、连接释放和 `auto` fallback 仍属于 transport。
- 畸形 SSE/WebSocket JSON 不再静默跳过。
- HTTP error 保留 status，供 `normalizeProviderError()` 映射稳定 error code。
- `sessionId` 映射到 `conversation_id`、`session_id`、`prompt_cache_key` 和 in-memory retention。

### Legacy

`projectResponsesAdapter()` 是唯一兼容方向：

- native 路径：失败时 iterator 与 result 都 reject 同一个结构化 `AIError`。
- legacy 路径：捕获 rejection，生成旧 `error` terminal event 和 error assistant message。
- Adapter、reducer 和 transport 都不依赖 legacy error classifier。

## 设计模式与维护性

- **Protocol Family Adapter**：三个 API 共享 Responses 事件状态机，不复制 parser。
- **Template Method**：`createResponsesAdapter()` 固定生命周期、终止和错误规则，Provider executor 只负责建立 transport 并送入事件。
- **Anti-corruption Layer**：legacy projector 隔离旧 error-event 契约，依赖方向只从兼容层指向新实现。
- **State Machine + Identity Map**：`output_index` 是流式 block 身份，不再依赖易错的“当前 block”。
- **Dependency Injection**：HTTP fetch 和 WebSocket constructor 均可由测试环境控制，功能测试不需要真实网络。
- **Single Ownership**：request mapping、wire validation、event reduction、transport retry 和兼容投影分别只有一个责任所有者。

## 测试

新增 `openai-responses-adapters.test.ts` 的 41 条离线功能测试：

- 三个 API 各覆盖 text/usage/lifecycle、tool delta/toolUse、wire validation、缺失 terminal、空流、incomplete、failed、HTTP 400、调用前 abort 和 legacy projection。
- 默认 `AdapterRegistry` 对三个 API 均验证原生 rejection，防止注册退回 `adaptApiProvider()`。
- 覆盖按 `output_index` 交错的 text/tool delta。
- 三个 SSE transport 均覆盖流中 abort。
- OpenAI 覆盖 cache/reasoning/service-tier/request 和价格倍率。
- Azure 覆盖 endpoint/deployment/reasoning 映射。
- Codex 覆盖 session headers/cache body、畸形 SSE JSON。
- Codex WebSocket 覆盖成功、畸形 JSON、terminal 前关闭和流中取消。

已有 `openai-codex-stream.test.ts` 的 session 用例过去在 header 断言失败后被内部 retry 吞掉，最终 legacy error result 仍让测试 resolve，单次耗时约 7 秒。补齐 session 字段后，该测试改为毫秒级真实通过；新原生矩阵直接断言 result/rejection，避免同类假阳性。

最终验证：

- 直接相关：`openai-responses-adapters` 41 条通过；连同现有 Responses/Codex/Registry 测试共 4 个文件、49 条通过。
- `packages/ai` 默认全量：35 个测试文件、200 条通过。
- `bun run check:quick`：通过。
- 根 `bun run check`：通过。
- `git diff --check`：通过。
- live Provider canary：未运行，当前环境没有对应凭据。

## 预期与实际

预期是复用已有 Responses parser，再给三个 Provider 各加一个 Adapter。实际审计表明 parser 本身缺少 wire/terminal law 且无法处理交错 item，因此先把它升级为明确状态机；这比在旧 parser 外包一层更接近长期目标。

预期 Codex session 测试已经固定兼容行为，实际发现 retry 把 mock assertion 当成网络错误，legacy error result 又让测试正常结束。新增 native 功能矩阵后，失败语义不再能被兼容结果掩盖。

TypeBox 的实际收益符合预期：它适合未知 wire 边界，但不足以独立表达事件顺序；顺序约束仍由显式状态机和功能测试负责。没有引入 Zod。

## 尚未完成

- 5 个 API 仍通过 legacy bridge：Anthropic、Google Generative AI、Gemini CLI、Vertex、Bedrock。
- OpenAI SDK 和 Codex transport retry 尚未统一到 Runtime，可观测尝试次数和预算仍不一致。
- WebSocket 测试使用确定性构造器，没有替代真实服务 canary。
- legacy `stream*()`、Legacy Registry 和兼容错误消息仍需等待 Phase 7 退出条件。

## 涉及文件

- `packages/ai/src/providers/openai-responses.ts`
- `packages/ai/src/providers/openai-responses/{adapter,events,legacy-stream,messages,options,request,response-schema}.ts`
- `packages/ai/src/providers/azure-openai-responses.ts`
- `packages/ai/src/providers/azure-openai-responses/{adapter,options,request}.ts`
- `packages/ai/src/providers/openai-codex-responses.ts`
- `packages/ai/src/providers/openai-codex/{adapter,events,request,stream,websocket}.ts`
- `packages/ai/src/providers/register-builtins.ts`
- `packages/ai/test/openai-responses-adapters.test.ts`
- `packages/ai/CHANGELOG.md`
