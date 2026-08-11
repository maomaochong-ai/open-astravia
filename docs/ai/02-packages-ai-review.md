# `packages/ai` 专项审计

## 总体判断

`packages/ai` 的核心价值是真实存在的：它用约 9 千行生产代码覆盖了 Anthropic、OpenAI Chat/Responses/Codex、Google、Vertex、Bedrock 和多种 OpenAI-compatible Provider，并为跨 Provider 消息交接做了专项处理。这不是低质量的简单封装。

主要问题是它已经超过了“一个紧凑统一层”能稳定承载的规模。协议、传输、认证、Provider、模型目录和进程配置相互穿透，导致新增 Provider 时需要理解并修改过多共享面。

## 做得好的部分

### 统一消息与跨 Provider 交接

统一的 `Message`、`ToolResultMessage`、thinking block 和 tool call 结构降低了上层 Agent 的复杂度。测试目录包含 `cross-provider-handoff`、tool call ID 归一化、thinking signature、图片工具结果和无结果工具调用等针对性场景。这些测试比只验证“能返回文本”更有价值。

### 模型描述可序列化

[`Model`](../../packages/ai/src/types.ts#L300) 是数据对象，而不是带闭包的 Provider 实例。它适合桌面应用持久化配置、跨 IPC 传输和模型选择 UI。Vercel 的模型实例设计更封装，但不应直接替换这一优势。

### Provider 覆盖贴近产品

OAuth、GitHub Copilot、Gemini CLI、OpenAI Codex WebSocket 等实现说明该包服务于实际桌面 Agent，而不只是公共 API SDK。对照仓库虽然更成熟，但产品目标并不完全相同。

### 局部纯逻辑测试有效

本次运行的 abort signal、thinking tag 拆分和跨协议消息变换测试均通过。Provider 请求构造、消息转换和若干兼容规则也已有独立测试文件。

## 问题清单

### AI-01：事件流没有完整的失败与关闭协议（P0）

证据：[`event-stream.ts`](../../packages/ai/src/utils/event-stream.ts#L4)

- `EventStream` 只有 resolve，没有 reject。
- `end(result?)` 允许省略结果；省略时迭代器结束，但 `result()` 永远 pending。
- 生产代码中的 [`streamProxy`](../../packages/agent/src/proxy.ts#L186) 确实会调用无结果的 `stream.end()`。
- 队列无界，也没有消费者取消或背压接口。

影响：同一个请求可能出现“事件消费已结束”和“最终结果永远不结束”两种互相矛盾的状态；更严重时，上层 Agent 会永久等待。

建议：把协议改成互斥终态 `close(result)` / `fail(error)` / `cancel(reason)`，三者都必须同时结束迭代器与最终 Promise。禁止无结果关闭一个要求最终结果的流。

### AI-02：工具参数验证在浏览器扩展中 fail-open（P1）

证据：[`validation.ts`](../../packages/ai/src/utils/validation.ts#L53)

当 AJV 不可用或运行于 Manifest V3 扩展时，代码直接返回 `toolCall.arguments`，注释明确写着信任模型输出。模型输出是外部不可信输入；对于文件、终端、网络等工具，绕过 schema 会把验证责任静默推给每一个工具实现。

此外：

- `strict: false` 与 `coerceTypes: true` 会改变输入，而返回类型仍是 `any`。
- 每次执行重新 compile schema，没有缓存。
- AJV 初始化失败只打印 warning，调用方无法知道验证已降级。

建议：默认 fail-closed。浏览器环境使用 CSP 兼容的解释式校验器或预编译 validator；如果必须跳过，应要求宿主显式开启 `unsafeSkipValidation`，并产生结构化 warning。

### AI-03：根入口包含进程级副作用（P1）

证据：[`stream.ts`](../../packages/ai/src/stream.ts#L1)、[`register-builtins.ts`](../../packages/ai/src/providers/register-builtins.ts#L108)、[`http-proxy.ts`](../../packages/ai/src/utils/http-proxy.ts#L8)

导入流 API 会：

1. 导入所有内置 Provider 并写入全局 Registry。
2. 在 Node 中异步修改 Undici 全局 dispatcher。

这会带来：

- 测试之间共享可变注册状态。
- 多租户或插件宿主无法自然隔离 Provider 集合。
- 一个库导入改变整个进程的 HTTP 行为。
- 根入口导出并触达多套重量级 SDK，削弱 tree-shaking 和浏览器可预测性。

建议：Provider Registry 变成显式实例依赖；HTTP proxy 由应用入口显式安装。根包保留无副作用的默认 facade，并为 Provider 使用独立 subpath 或独立包。

### AI-04：类型系统在最需要约束的边界失效（P1）

证据：[`types.ts`](../../packages/ai/src/types.ts#L113)

- `ProviderStreamOptions = StreamOptions & Record<string, unknown>` 使 `stream()` 无法根据 `model.api` 推导具体 Provider options。
- `ToolCall.arguments`、`ToolResultMessage` 默认和多处事件字段使用 `any`。
- `ThinkingLevel` 接受任意字符串，错误值只能由远端 Provider 发现。
- Registry 通过断言把通用 `Model<Api>` 和 `StreamOptions` 转回具体类型。

这不只是代码风格问题。公共 API 表面看起来泛型化，实际在 Registry 边界丢失了关联类型，调用者也得不到 Provider-specific 参数提示。

建议：使用 `ApiOptionsMap` 或判别式 model descriptor 保留 `api -> options` 映射；工具输入在“流式未完成”阶段保持 `unknown`，完成并验证后才变成 schema 推导类型。

### AI-05：模型查询 API 的返回类型不真实（P1）

证据：[`models.ts`](../../packages/ai/src/models.ts#L15)

`getModel()` 声明返回 `Model<Api>`，但找不到 Provider 或模型时实际返回 `undefined`，只是通过类型断言隐藏。这会把一个正常的查找失败变成远处的空引用错误。

建议：改为 `Model<Api> | undefined`，或新增 `requireModel()` 抛出可识别的 `ModelNotFoundError`。迁移期可以保留旧函数并标记弃用。

### AI-06：错误被压成字符串或 assistant 消息（P1）

Provider 大量抛出普通 `Error`，上层再把错误转换为 `errorMessage`。HTTP 状态、请求 ID、响应体、是否可重试、重试等待时间、Provider 原始错误码等信息缺少统一合同。

对照仓库的 `AISDKError` / `APICallError` 不是必须原样复制，但以下最小分类值得引入：

- `AuthenticationError`
- `RateLimitError`，包含 `retryAfterMs`
- `ProviderResponseError`，包含 status、headers、requestId、raw body
- `InvalidProviderResponseError`
- `ContextOverflowError`
- `AbortError` / `TimeoutError`
- `ToolInputValidationError`

错误类应支持跨包版本识别，避免仅依赖 `instanceof`。

### AI-07：Provider 能力和兼容规则进入共享模型类型（P2）

[`OpenAICompletionsCompat`](../../packages/ai/src/types.ts#L241) 把 URL 探测、Mistral tool ID、Qwen/NVIDIA/DeepSeek thinking 格式、OpenRouter 和 Vercel Gateway 路由集中到共享类型。短期方便，长期会使每个 OpenAI-compatible 差异都扩张核心协议。

建议：共享协议只保留标准能力；兼容规则放进具体 adapter 的 capabilities/options schema。模型目录可引用 adapter key，但不应承载 adapter 的全部行为分支。

### AI-08：usage 模型不支持可靠诊断（P2）

证据：[`Usage`](../../packages/ai/src/types.ts#L162)

当前 usage 的所有字段都是必填 `number`，未知值通常被填为 `0`，无法区分“Provider 报告为 0”和“Provider 没有报告”。也没有保留 raw usage、reasoning output tokens、请求/响应 metadata 或 warning。

对于“系统提示词、skill、历史消息、工具 schema 各占多少上下文”这一需求，Provider 最多通常只返回总输入 token，无法直接提供分区数据。可靠的分区视图必须在请求组装阶段记录来源，并用目标模型 tokenizer 估算；Provider 返回的总量只能用于校准。

建议引入：

```ts
interface PreparedContextSegment {
  id: string;
  kind: "system" | "skill" | "history" | "tool" | "attachment" | "other";
  source?: string;
  estimatedTokens: number;
  exact: false;
}
```

同时让标准 usage 字段可为 `undefined`，保留 `raw`，并明确 total 的计算口径。

### AI-09：JSON/SSE 解析缺少统一可信边界（P2）

[`parseStreamingJson`](../../packages/ai/src/utils/json-parse.ts#L10) 在任何失败时返回 `{}`，会把“尚未完成”“语法错误”“危险对象键”和“合法空对象”混为一谈。多处 Provider 与代理代码直接 `JSON.parse` 后断言类型。

建议集中建设 Provider 工具层：安全 JSON 解析、schema 验证、标准 SSE parser、响应大小限制、错误响应 handler、重试策略和 URL 验证。对照仓库的 `provider-utils` 可以作为设计参考，但只选当前需要的子集。

## 测试与质量门禁

优点：现有测试对 Provider quirks 和跨 Provider handoff 覆盖较好。

缺口：

- 没有 `EventStream` 自身的终止/失败/多消费者契约测试。
- 没有 `.test-d.ts` 类型测试，无法保护公共泛型推导。
- 没有明确的 Node/edge/browser 双运行时矩阵。
- 大型 `stream.test.ts` 依赖真实凭据，关键协议回归容易被跳过。

建议优先增加纯离线合同测试，再保留真实 Provider canary。离线测试应该覆盖每个 Provider 的请求转换、响应 chunk schema、终止事件和错误映射。
