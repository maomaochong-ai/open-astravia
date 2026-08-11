# Phase 3C：Anthropic 与 Bedrock 原生 Adapter

## 目标与范围

本阶段迁移两个 Messages/Converse 风格 API：

- `anthropic-messages`
- `bedrock-converse-stream`

完成标准与前两个批次一致：request、wire validation、事件归约、失败、取消和终止语义必须由 `LanguageModelAdapter` 原生拥有，`AdapterRegistry` 不再通过 `adaptApiProvider()` 接入这两个 API。旧 `streamAnthropic()` / `streamBedrock()` 继续保留，但只允许把原生 rejection 单向投影为旧 `error` terminal event。

本阶段不迁移 Google 三种 API，不统一 SDK retry，不删除 legacy registry，也不运行 UI 测试。

## 修改前问题

- Anthropic 虽已有注入式 `fetch` 和 TypeBox 试点，Registry 仍注册 legacy bridge；失败先变成 error assistant message，再被新 Runtime 反向分类。
- Anthropic reducer 不要求 `message_start` / `message_stop` 完整出现，也不拒绝未闭合、重复或乱序 content block。
- Bedrock 直接在 legacy stream 中创建 AWS client；离线测试只能覆盖 request/message 转换，无法完整驱动 SDK event stream。
- Bedrock 没有运行时 wire schema，`response.stream` 缺失、空流、缺失 `messageStop` 或未闭合 block 都可能落成正常 `done`。
- Bedrock request-level SDK error 的 HTTP 状态位于 `$metadata.httpStatusCode`，原错误归一化只读取 `status`，会把 403/429 等错误降级为普通 transport failure。
- Anthropic 与 Bedrock 重复维护 Claude 4.6 adaptive thinking 和 effort 映射；OpenAI-compatible 与 Responses 又各自复制 legacy compatibility projector。

## 三次设计迭代

### 第一次：尝试共享 Messages reducer

最初设想是让 Anthropic 与 Bedrock 共用一个“Claude Messages reducer”。审计后否决：Anthropic 以显式 `content_block_start/delta/stop` 和 `message_stop` 建模；Bedrock 文本/推理通常由首个 delta 隐式开始，工具才有 start，而且允许 `messageStop` 后再到 `metadata`。强行共享会把 AWS 分支、Anthropic block 类型和终止顺序塞进同一状态机，降低可读性并扩大回归面。

调整后只共享真正稳定的 Claude 语义：adaptive-thinking 模型识别与 reasoning-to-effort 映射。两个 wire reducer 独立。

### 第二次：评估把 AWS client 放进 `BedrockOptions`

为了离线测试，曾考虑增加公共 `client` 或 `send` option。否决原因是这会把 AWS SDK 类型泄漏进公共 stream contract，并让生产调用方获得替换 transport 的非必要能力。

最终使用 Adapter factory 的构造注入：`createBedrockAdapter({ send })` 只用于组装和测试，默认 `bedrockAdapter` 仍在内部创建真实 SDK client。region/profile/signal 继续属于现有 `BedrockOptions`，client 实例不进入协议对象。

### 第三次：对照 Vercel AI 后收紧终止律

本机 `C:\develop\github\ai` 的 Anthropic/Bedrock Provider 展示了值得采用的实践：按 Provider 分包、mock transport、直接断言 request/stream parts，并分别覆盖 reasoning、tool、usage、cache 和错误事件。它的功能覆盖面显著大于原 Vetta 测试。

但实现不能照搬。当前 Vercel Bedrock transform 在 `flush()` 中生成 finish，即便上游没有合法 `messageStop`；这适合其 stream-part contract，不满足 Vetta “持久化前必须证明 Provider 成功终止”的要求。本阶段因此增加严格 terminal law，并把缺失 terminal、未闭合 block 和乱序事件作为失败。

## 模块划分

| 模块 | 职责 |
| --- | --- |
| `anthropic/adapter.ts` | Client/request 组装、原生 stream settlement、abort 与 SDK 错误归一化 |
| `anthropic/events.ts` | Anthropic message/content block 状态机、thinking signature、tool delta、usage/cost |
| `anthropic/response-schema.ts` | Anthropic 六类 wire event 与关键字段的 TypeBox schema |
| `anthropic/stream.ts` | legacy compatibility facade 与 `SimpleStreamOptions` 映射 |
| `amazon-bedrock/adapter.ts` | 原生 Adapter、默认 AWS command sender 与可注入离线 sender |
| `amazon-bedrock/events.ts` | Converse event 状态机、stream exception/status、usage/cost |
| `amazon-bedrock/response-schema.ts` | Converse event union、delta、usage 和 exception 的 TypeBox schema |
| `amazon-bedrock/stream.ts` | legacy compatibility facade 与 reasoning budget 映射 |
| `claude-thinking.ts` | Anthropic 与 Bedrock 共用的 Claude adaptive thinking/effort 规则 |
| `legacy-adapter-stream.ts` | 所有原生 Adapter 到旧 `AssistantMessageEventStream` 的单向投影 |

顶层 `anthropic.ts` 与 `amazon-bedrock.ts` 只导出 adapter/options/stream facade。request、message conversion、transport 和 reducer 仍由各自模块所有。

## 状态机与终止语义

### Anthropic

成功必须满足：

1. 恰好一个 `message_start`。
2. 每个 protocol index 只能 start/stop 一次；delta 必须指向 active block，且 delta 类型与 block 类型一致。
3. `message_delta.stop_reason` 必须在所有 block 关闭后出现。
4. `message_stop` 必须存在，且到达时没有 active block。
5. `message_stop` 后不允许再有 wire event。

text、thinking、signature 和 tool JSON delta 都保留原语义。`redacted_thinking`、server tool 和 web-search result 目前只跟踪生命周期，不错误投影为正文；它们的完整公共内容表示属于后续独立功能扩展。

### Bedrock

成功必须满足：

1. 首事件生命周期中存在且只存在一个 assistant `messageStart`。
2. text/reasoning 可以由首个 delta 隐式创建；tool block 必须由 `contentBlockStart` 创建。
3. 所有 block 都必须收到 `contentBlockStop`，关闭后的 index 不得重新接收 delta。
4. 必须收到 `messageStop`；其后只允许协议规定的 `metadata`。
5. 空 iterable、缺失 `response.stream`、未知 union member 或 EOF 无 terminal 都拒绝。

`content_filtered`、guardrail 和 malformed output/tool stop reason 不是成功终态；stream exception 会携带 400/429/500/503 status 进入统一错误归一化。

## TypeBox、Zod 与类型边界

本阶段继续使用 TypeBox，不引入 Zod：

- 两个 SDK 的 TypeScript 类型只描述编译期，不能证明运行时 event 结构。
- TypeBox 已是 `@vetta/ai` 公共 schema 体系和 Phase 2/3 既有依赖，继续用于不可信 wire 边界可避免两套 schema runtime、错误格式和测试工具并存。
- Anthropic schema 校验 block/delta 判别项、index、usage 和 stop reason；Bedrock schema 校验 event union、delta、metadata usage 和 exception。
- 事件顺序、唯一性和 EOF 规则不能仅靠 TypeBox/Zod 表达，继续由显式状态机承担。
- AWS SDK command/request 等内部已类型化对象不做重复 schema 校验。

Vercel AI 在其 Provider Core 体系中使用 Zod 是合理选择，因为它的公共 schema、safe-parse 和错误设施围绕 Zod 建立；这不是在 Vetta 同时引入 Zod 的理由。

## 错误、取消与兼容

- 原生 Adapter 的 iterator 与 `result` 对失败/取消拒绝同一个结构化 `AIError`。
- Anthropic SDK 自己发现的 event-order 错误转换为 `AI_STREAM_PROTOCOL_FAILED`，不误报为连接失败。
- Anthropic 默认 SDK retry 保持现状；本阶段没有把 retry policy 偷渡进 Adapter Runtime。
- Bedrock streamed exception 映射明确 status；request error 同时读取 `status` 与 `$metadata.httpStatusCode`。
- 调用前已取消时不触发 fetch/sender；流中取消最终稳定映射为 `AI_ABORTED`。
- `projectLanguageModelAdapter()` 集中实现 legacy error-event 投影，OpenAI Completions、Responses、Anthropic 和 Bedrock 不再各自复制兼容代码。

## 测试

新增 `anthropic-bedrock-adapters.test.ts` 20 条离线功能测试：

- Anthropic：thinking/signature、text、tool JSON 分片、cache usage、request payload、429、空流、缺失 terminal、未闭合 block、delta 乱序、wire schema、调用前/流中 abort、legacy projection。
- Bedrock：reasoning/signature、text、tool JSON 分片、metadata/cache usage、request/signal 观察、空流、缺失 terminal、未闭合 block、delta 乱序、wire schema、streamed throttling、AWS `$metadata` 403、调用前/流中 abort。
- Bedrock 使用注入 sender 和 async iterable，不需要 AWS 凭据、真实 endpoint 或付费调用。

最终验证：

- 直接相关：6 个测试文件、49 条通过。
- `packages/ai` 默认全量：36 个测试文件、220 条通过。
- `packages/agent` 默认全量：16 个测试文件、93 条通过。
- 根 `bun run tsc`：通过。
- `bun run check:quick`：通过。
- 根 `bun run check`：通过；默认沙箱无法读取 Admin 私有 `node_modules/@types`，按相同命令在沙箱外复跑后 lint、五组类型检查和全部 guards 通过。
- `git diff --check`：通过。
- live Anthropic/Bedrock canary：未运行；无凭据且任务禁止使用真实付费 Provider。
- UI 测试：按用户明确要求未运行，本阶段没有 UI 改动。

Windows 当前 shell 中 `node` 被 Bun shim 替代，直接 `bunx vitest` 的 worker 会报 file URL/MessagePort 兼容错误；测试实际使用 Codex bundled Node 执行同一根 Vitest 入口。该问题不属于 Provider 实现失败。

## 预期与实际

预期是把 Anthropic 现有 parser 包进原生 Adapter，再让 Bedrock复用。实际发现旧 parser 的终止律不足，而两个 wire 协议的 block 起始和 metadata 顺序不同，因此实现了两个小型显式状态机，只共享 Claude 规则。

预期 Bedrock 只需 mock AWS client。实际直接注入 client 会扩大公共契约，最终改为 Adapter 构造注入 command sender；测试能力更强，生产 options 没有新增 SDK 泄漏。

对照 Vercel 后没有追求一次补齐其全部 server tool、citation、compaction 和 provider metadata 功能。这些是独立产品功能，不应混入内部迁移。当前阶段优先保证 Vetta 已有 text/thinking/tool/cache 合同不回归，并建立后续扩展可测试的 wire 边界。

## 已完成与未完成

已完成：

- Anthropic 与 Bedrock 注册原生 Adapter；原生 API 总数从 9 增至 11。
- 两个 Provider 均具备 TypeBox wire schema、严格 terminal law、结构化失败和确定性取消测试。
- Claude thinking/effort 与 legacy projector 的真实重复已收敛。
- AWS response metadata 的 HTTP status 可进入统一错误分类。

未完成：

- Google Generative AI、Gemini CLI、Vertex 三个 API 仍由 legacy bridge 接入。
- Anthropic server tools、citations、context management/compaction 和 Bedrock image/tool-result output 尚无完整公共协议表示；不能因 reducer 能忽略其生命周期而宣称支持。
- SDK retry 尚未上移到 Runtime，跨 Provider attempt telemetry 仍不统一。
- live canary 与 Phase 7 legacy 删除仍受凭据和发布周期退出条件约束。

## 涉及文件

- `packages/ai/src/providers/{claude-thinking,legacy-adapter-stream}.ts`
- `packages/ai/src/providers/anthropic.ts`
- `packages/ai/src/providers/anthropic/{adapter,events,options,response-schema,stream}.ts`
- `packages/ai/src/providers/amazon-bedrock.ts`
- `packages/ai/src/providers/amazon-bedrock/{adapter,events,options,response-schema,stream}.ts`
- `packages/ai/src/providers/openai-completions/stream.ts`
- `packages/ai/src/providers/openai-responses/legacy-stream.ts`
- `packages/ai/src/providers/register-builtins.ts`
- `packages/ai/src/provider-kit/provider-error.ts`
- `packages/ai/test/anthropic-bedrock-adapters.test.ts`
- `packages/ai/CHANGELOG.md`
