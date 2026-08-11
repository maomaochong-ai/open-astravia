# Phase 3D：Google 协议族原生 Adapter

## 目标与范围

本阶段迁移最后三个仍由 `adaptApiProvider()` 接入的内置 API：

- `google-generative-ai`
- `google-vertex`
- `google-gemini-cli`，包括 `google-antigravity` provider 变体

完成标准不是“Registry 有条目”，而是 request、transport、wire validation、事件归约、usage、失败、取消与终止语义都由原生 `LanguageModelAdapter` 所有。旧 `streamGoogle*()` 入口继续存在，但只把原生 rejection 单向投影为兼容 `error` event。

本阶段不删除 legacy registry，不统一所有 SDK retry，不增加 server-side tools/grounding 等公共内容类型，不调用真实 Google 服务，也不运行 UI 测试。

## 修改前问题

- `google.ts` 与 `google-vertex.ts` 各约 400 行，client、request、thinking、chunk reducer、usage 和 legacy stream 几乎逐段复制。
- Gemini CLI 的 raw SSE parser 又复制同一套 text/thinking/tool reducer，畸形 JSON 被静默跳过。
- 三条流都允许在未观察到 `finishReason` 时把 EOF 当作成功，截断响应可能被上游持久化。
- 官方 Gemini/Vertex 把 `promptTokenCount` 同时记为 `input`，又把 `cachedContentTokenCount` 记为 `cacheRead`；按公共 Usage 语义会重复计算 token 与输入成本。
- Cloud Code Assist 的非重试型 4xx 在旧 `try/catch` 结构中仍会进入网络错误重试，并且抛出的普通 Error 不携带 status，无法稳定区分 401/403/429。
- 顶层 provider 文件同时负责装配、业务规则和流状态，无法针对 SDK sender 或 reducer 做精确离线测试。

## 三次设计迭代

### 第一次：按三个 Provider 各自拆包

最初方案是照 Anthropic/Bedrock 的结构，为 Gemini API、Vertex 和 Gemini CLI 各建一套 adapter/events/schema。这能快速降低顶层文件长度，但会保留三份完全相同的 Gemini `candidates[0].content.parts` 归约规则，下一次修复 signature、tool call 或 usage 时仍可能只修两处。

调整为共享协议层：`google-stream` 只理解 Gemini response chunk，不理解 API key、ADC、OAuth、endpoint 或 retry；三个 transport 只负责产生未知 chunk。

### 第二次：尝试统一为一个 Google transport

官方 Gemini 与 Vertex 都使用 `@google/genai`，曾考虑用一个 client factory 加配置分支；进一步审计 Gemini CLI 后否决了整个协议族单 transport：

- Gemini API 使用 API key 与可选自定义 base URL。
- Vertex 使用 ADC、project、location 与固定 API version。
- Gemini CLI 使用 OAuth JSON credentials、Cloud Code 内部 endpoint、SSE、endpoint fallback、429/5xx retry 和空流 retry。

最终只让官方 Gemini/Vertex 复用 SDK adapter factory，各自保留 client/request；Gemini CLI 保留专属 transport 和 retry。身份与网络策略不会污染 reducer。

### 第三次：对照 Vercel AI 后调整严格度与功能边界

本机 `C:\develop\github\ai` 的 Google provider 有大量 mock server 功能测试，覆盖 reasoning、thought signature、tool call、usage、finish reason、grounding 和较新的 partial function arguments。这些 fixture 组织和对 request/stream parts 的直接断言值得采用。

但没有照搬其单个超大 `google-language-model.ts`，也没有沿用 TransformStream `flush()` 无条件发 finish 的做法。Vetta 的 Agent 会持久化最终 assistant message，因此本阶段要求至少一个合法 provider chunk 和明确 `finishReason`；terminal 后只允许 usage-only chunk，不允许新的 candidate。缺失终态、terminal 后正文和畸形 wire 数据都有限拒绝。

Vercel 已支持的 partial function arguments、server tools、grounding 和 URL context 不是本次内部重构可顺带加入的功能。当前 Vetta request 没有启用 streamed function arguments；若 provider 意外返回 partial 参数，reducer 明确拒绝，而不是生成重复或不完整工具调用。后续应先扩展公共内容/事件协议，再独立实现这些能力。

## 模块划分

| 模块 | 职责 |
| --- | --- |
| `google-stream/response-schema.ts` | 三种入口共享的 TypeBox response chunk schema；允许真实 API 的 nullable metadata |
| `google-stream/events.ts` | text/thinking/signature/tool/usage/finish reducer 与严格 terminal law |
| `google-stream/adapter.ts` | SDK iterable 到原生 stream/result 的通用装配、wire validation、abort 和错误归一化 |
| `google-stream/request.ts` | Gemini API/Vertex 共用的 GenerateContent request 结构，不处理身份 |
| `google-stream/thinking.ts` | Gemini 3 thinking level 与 2.5 token budget 规则 |
| `google/{client,request,adapter,stream}.ts` | API key client、官方请求、可注入 sender、legacy facade |
| `google-vertex/{client,request,adapter,stream}.ts` | ADC/project/location client、Vertex enum 映射、sender 与 facade |
| `google-gemini-cli/adapter.ts` | OAuth/endpoint/retry/SSE 原生 Adapter 编排 |
| `google-gemini-cli/response.ts` | 可取消 SSE record 解析；畸形 JSON 进入稳定 validation error |
| `google-gemini-cli/retry.ts` | endpoint fallback、HTTP/network retry、Retry-After 与 status 保留 |

顶层 `google.ts`、`google-vertex.ts` 和 `google-gemini-cli.ts` 已变成轻量导出入口。公共 options 不暴露 SDK client；官方/Vertex 通过 Adapter factory 注入 sender 进行离线测试，Gemini CLI 继续使用已有 `StreamOptions.fetch` 注入。

## 协议与终止律

共享 reducer 的成功条件：

1. transport 至少产生一个可解析的 provider event；真正的零事件流是 `AI_STREAM_PROTOCOL_FAILED`。
2. 必须在首 candidate 观察到非空 `finishReason`。
3. `finishReason` 可以与最后一批 content 同 chunk 到达；到达时关闭当前 text/thinking block。
4. terminal 后允许独立的 usage-only chunk，以兼容 Google 常见的末尾 usage 帧；不允许新的 candidate、content 或第二个 finish。
5. `STOP` 映射为 `stop`，`MAX_TOKENS` 映射为 `length`；已有工具调用时成功终态为 `toolUse`。
6. safety、malformed function call 等非成功 finish reason 不产出 `done`。

连续同类型 text/thinking part 归并为一个内容块，类型切换或工具调用前显式结束当前块。thought signature 只附着于其原 part/block，不把 signature 本身误判为 thinking。无参数 function call 归一为 `{}`，重复或缺失 provider id 才生成本请求内唯一的兼容 id。

## Usage 与错误语义

公共 Usage 已有明确语义：`input` 是非缓存输入，`cacheRead` 单独计数。因此三种 Google 入口现在统一为：

```text
input = max(0, promptTokenCount - cachedContentTokenCount)
output = candidatesTokenCount + thoughtsTokenCount
cacheRead = cachedContentTokenCount
totalTokens = provider totalTokenCount
```

这修复了官方 Gemini/Vertex 的重复计费，同时保留 provider 原生 `totalTokenCount`。

Cloud Code retry 现在区分：

- 网络异常：指数退避重试。
- 429/500/502/503/504 或明确 overload 文本：按 Retry-After/限流 header 或指数退避重试。
- 401/403/普通 400/404 等：立即失败，不误重试。
- HTTP error 保留 `status`，进入 `AI_AUTHENTICATION_FAILED`、`AI_PERMISSION_DENIED`、`AI_RATE_LIMITED` 等稳定分类。
- 调用前和流中取消都拒绝为 `AI_ABORTED`，不生成成功 assistant message。

空 SSE 保留既有最多两次额外尝试和退避，但只对真正的零 event stream 重试；已经收到畸形 event 或无 terminal event 时直接失败，避免把协议错误伪装成暂时空响应。

## TypeBox 与 Zod

继续使用 TypeBox，不引入 Zod：

- `@vetta/ai` 的 Tool schema、wire pilot、validation error 和测试设施已经围绕 TypeBox。
- Google SDK 类型与手写 Cloud Code 类型只能提供编译期约束；SDK、代理和 SSE 仍是不可信运行时边界。
- TypeBox 负责 chunk 字段形状；事件顺序、terminal 唯一性、block 切换和 partial function argument policy 由 reducer 负责。
- request、client config 和内部状态已经由 TypeScript 类型覆盖，不重复做运行时 schema。

Vercel AI 使用 Zod 与其 Provider Core schema 体系一致，但在 Vetta 同时维护 TypeBox/Zod 两套运行时、错误格式和推导工具只会增加维护成本。除非未来整个公共 schema 体系迁移，否则没有局部引入 Zod 的收益。

## 测试

新增 `google-native-adapters.test.ts` 15 条离线功能测试：

- 官方 Gemini：thinking/text/tool/signature、request payload、cache usage、空流、缺失 terminal、terminal 后 candidate、wire validation、failed finish、调用前/流中取消。
- Vertex：使用同一 reducer，同时证明 project/location 仍停留在 Vertex transport options。
- Gemini CLI：完整 SSE、畸形 JSON、畸形 wrapper、缺失 terminal、401 分类且不重试、调用前取消。

继续通过的既有 Google 测试覆盖 Gemini 3 unsigned history tool call、thinking signature、空流后成功重试、Retry-After、Claude thinking header 和无参数工具调用。

验证结果：

- Google 直接相关：7 个测试文件、29 条通过。
- `packages/ai` 默认全量：37 个测试文件、235 条通过。
- `packages/agent` 默认全量：16 个测试文件、93 条通过。
- `packages/ai` TypeScript 检查：通过。
- `bun run check:quick`：通过。
- 根 `bun run check`：通过，lint、root/CLI/Desktop/Admin/Docs 类型检查与全部架构守卫均通过。
- `git diff --check`：通过。
- live Google canary：未运行；当前任务没有授权使用真实凭据或付费 Provider。
- UI 测试：按用户明确要求未运行，本阶段无 UI 改动。

## 预期与实际

预期主要工作是消除 `google.ts`/`google-vertex.ts` 复制。实际审计发现更重要的是三个入口共享的截断成功、cache token 重复计费、Cloud Code 4xx 误重试和畸形 SSE 静默忽略。这些行为都通过原生合同测试修正，而不是只移动文件。

预期可直接参考 Vercel 的 Google reducer。实际其目标协议包含更多 provider metadata、server tool 和 file part，且允许 flush 合成 finish；直接移植会同时扩大 Vetta 公共协议与本次重构范围。最终只吸收其 fixture-first 测试思想和 transport/schema 分层，不复制其单文件结构与宽松终止行为。

## 已完成与未完成

已完成：

- 14 个内置 API 全部注册原生 `LanguageModelAdapter`；`registerBuiltInAdapters()` 不再对内置项使用 fallback。
- 三种 Google transport 共用一个 TypeBox wire schema、事件 reducer、usage 与 terminal law。
- 顶层 provider 文件轻量化；官方/Vertex sender 与 CLI fetch 均可离线注入。
- Google cache usage、Cloud Code 4xx retry/status、SSE JSON 和缺失终态问题有回归测试。

未完成：

- `adaptApiProvider()` 与 legacy registry 仍服务公共 `stream*()` 兼容和外部扩展，需按 Phase 7 发布周期退出，不能立即删除。
- Provider 内部 retry 尚未统一上移到 Runtime，attempt telemetry/预算仍不一致。
- partial function arguments、server tools、grounding、URL context、inline output file 尚无 Vetta 公共协议表示。
- live canary 和真实 ADC/OAuth/proxy 行为仍需具备凭据的受控环境验证。

## 涉及文件

- `packages/ai/src/providers/google.ts`
- `packages/ai/src/providers/google/{adapter,client,options,request,stream}.ts`
- `packages/ai/src/providers/google-vertex.ts`
- `packages/ai/src/providers/google-vertex/{adapter,client,options,request,stream}.ts`
- `packages/ai/src/providers/google-stream/{adapter,events,request,response-schema,thinking}.ts`
- `packages/ai/src/providers/google-gemini-cli.ts`
- `packages/ai/src/providers/google-gemini-cli/{adapter,options,protocol,response,retry,stream}.ts`
- `packages/ai/src/providers/register-builtins.ts`
- `packages/ai/test/google-native-adapters.test.ts`
- `packages/ai/CHANGELOG.md`
