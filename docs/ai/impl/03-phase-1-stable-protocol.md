# Phase 1：AI 稳定协议

## 1. 阶段目标

本阶段把 Provider 中立、需要长期稳定的类型从单体 `types.ts` 移交到 `protocol/`，并建立结构化错误与可测试的流终止判断。

明确不做：

- 不在同一阶段重写全部 Provider。
- 不立即删除旧根导出。
- 不把旧 `error` 事件直接改成 iterator rejection。
- 不在尚无 Adapter/transport 边界时引入全量 Provider payload schema。
- 不修改 Agent 与 Runtime 的产品行为。

## 2. 实际模块划分

| 模块 | 所有权 | 依赖约束 |
| --- | --- | --- |
| `protocol/identity.ts` | API 与 Provider 标识 | 无 Provider SDK 依赖 |
| `protocol/reasoning.ts` | 通用 reasoning level 与 token budget | 不包含 Agent 的 `off` 产品状态 |
| `protocol/usage.ts` | token 与 cost usage | 保留当前兼容数值语义 |
| `protocol/finish-reason.ts` | 成功、失败和总 stop reason | Provider raw reason 不进入此层 |
| `protocol/tool.ts` | tool schema、tool call、JSON 类型 | 仅依赖 TypeBox 的 `TSchema` 类型 |
| `protocol/message.ts` | user/assistant/tool-result 消息和内容块 | 依赖同层 identity/usage/tool |
| `protocol/context.ts` | 单次模型调用上下文 | 不包含 Session 状态 |
| `protocol/stream-event.ts` | 兼容流事件、终态 type guard 与结果提取 | 非终态结果提取抛结构化协议错误 |
| `protocol/errors.ts` | 稳定错误码、`AIError` 及专用错误 | 不解析 Provider 原始响应 |
| `protocol/index.ts` | 稳定协议子路径门面 | 只汇总以上模块 |

`types.ts` 现在只继续拥有调用选项、Provider 兼容配置和 `Model` 描述，并对协议类型做 exact type re-export。现有 Provider 继续从 `types.ts` 导入时，拿到的已经是协议层定义，不存在复制的第二份类型。

## 3. 公共 API 与兼容

新增 package export：

```text
@vetta/ai/protocol
```

根 `@vetta/ai` 仍导出相同协议类型，避免要求所有上游一次性改 import。根 `tsconfig.json` 和 Desktop 独立 `tsconfig.json` 均增加精确 path mapping，确保 NodeNext 与 bundler 两种解析模式一致。

协议测试使用 `expectTypeOf(...).toEqualTypeOf(...)` 验证以下旧类型是新协议类型的精确别名：

- `AssistantMessage`
- `AssistantMessageEvent`
- `ToolCall`
- `Usage`

## 4. 结构化错误

新增稳定错误码：

- `AI_AUTHENTICATION_FAILED`
- `AI_PERMISSION_DENIED`
- `AI_RATE_LIMITED`
- `AI_CONTEXT_OVERFLOW`
- `AI_INVALID_REQUEST`
- `AI_RESPONSE_VALIDATION_FAILED`
- `AI_STREAM_PROTOCOL_FAILED`
- `AI_TRANSPORT_FAILED`
- `AI_ABORTED`
- `AI_UNSUPPORTED_CAPABILITY`

`AIError` 提供 `code`、`retryable`、`statusCode`、`provider`、`modelId`、`requestId`、`metadata` 和 `cause`。应用可以按稳定 code 分支，不再要求匹配 message 文本。

当前已接入的生产路径是 EventStream 的“无终态 EOF”：

- 原内部 code：`EVENT_STREAM_ENDED_WITHOUT_RESULT`。
- 新稳定 code：`AI_STREAM_PROTOCOL_FAILED`。
- 细分原因：`metadata.reason = "ended_without_result"`。

`EventStreamEndedWithoutResultError` 继续保留类名兼容，但改为继承 `AIStreamProtocolError`。Agent 跨包测试同步验证 code 与 metadata。

Provider HTTP/鉴权/限流错误尚未全部映射为 `AIError`，因为可靠映射需要 Phase 2 的 adapter 与 transport 边界；本阶段只先稳定可依赖的错误分类。

## 5. 流事件与终态规则

新增：

- `AssistantMessageDoneEvent`
- `AssistantMessageErrorEvent`
- `AssistantMessageTerminalEvent`
- `isAssistantMessageTerminalEvent()`
- `getAssistantMessageEventResult()`

`AssistantMessageEventStream` 不再内联重复 `done/error` 判断，而是复用协议 helper。契约测试通过包含 12 个事件分支的穷尽 switch 保证判别联合可穷尽检查。

旧 `error` 事件仍作为兼容终态并让 `result()` resolve 为错误 AssistantMessage。这与目标架构的“新流失败统一 iterator rejection”不同，但本阶段有意保留：若现在修改，会同时改变全部 Provider、Agent 和 UI 观察行为。Phase 2 应新增 ModelStream 契约及 compat adapter，由 adapter 把旧错误事件投影为新失败通道。

## 6. Tool 参数类型的两轮调整

第一次尝试把 `ToolCall.arguments` 从 `Record<string, any>` 直接收紧为递归 `JsonObject`。类型检查暴露以下影响：

- Provider parser 普遍产出 `Record<string, unknown>`。
- Runtime Storage 的既有 schema 仍声明 unknown map。
- CLI、Coding Agent fixture 和插件桥接使用 readonly/unknown 对象。
- 一次性改为递归 JSON 会迫使上游存储、fixture 和插件协议同步迁移。

这不符合 Phase 1 的兼容边界，因此第二轮调整为：

- `ToolCall.arguments` 使用 `Record<string, unknown>`，移除 `any`，调用方必须在使用前收窄。
- 保留 `JsonPrimitive`、`JsonValue`、`JsonObject` 作为真实 JSON 边界类型。
- Bedrock 请求转换在 SDK 边界递归验证 unknown 并构造 `JsonValue`。
- 非 JSON 值（如 `undefined`）明确抛错，不通过类型断言绕过。
- live 工具算术测试先检查 `a/b/operation` 类型，再执行运算。

这兼顾了类型安全和分阶段迁移：内部不再使用 `any`，外部 JSON 严格性由真正需要 JSON 的边界负责。

## 7. TypeBox、Zod 决策

本阶段不引入 Zod，也不为协议对象添加 TypeBox runtime schema。

原因：

- 协议抽取主要是内部编译期所有权迁移。
- 同时维护 TypeScript interface 与 Zod schema 会形成双重类型源。
- 当前唯一新增运行时边界只是递归 JSON value，直接递归校验比引入 schema runtime 更小且错误位置更明确。
- `Tool` 已以 TypeBox `TSchema` 为现有 schema 标准；Phase 2 的 Provider wire payload 若需要校验，应继续优先 TypeBox，避免同时维护 TypeBox 与 Zod。

Phase 2 应按 wire fixture 证明 schema 的收益，而不是机械地给全部内部对象套 schema。

## 8. Vercel AI 对照后的修正

Vercel AI 的强项是将公开模型协议、Provider 实现和测试工具分开，并通过 Provider 级功能测试验证转换。可借鉴的是稳定公共类型和受控 Provider 输入，不是文件数量或所有抽象名称。

本阶段没有照搬其完整 LanguageModel 版本协议，原因是当前 Vetta 上游大量依赖 `AssistantMessageEvent`。先建立 exact alias 与 canonical 差分，再通过 Adapter 迁移，能让每个 Provider 批次独立验证和回滚。直接复制 Vercel AI 的新接口会把一次协议升级变成全仓大爆炸式修改。

## 9. 测试证据

先红后绿：

- 新协议测试首次运行：因 `src/protocol/index.js` 不存在而失败，确认测试约束的是新 API。
- 第一次 `ToolCall.arguments = JsonObject`：根类型检查暴露 Provider、Storage、CLI、插件与 fixture 的兼容问题。
- Agent 首次回归：仅旧 EventStream code 断言失败；更新为稳定 code + metadata 后通过。

最终结果：

- 协议 + EventStream + Bedrock 边界：3 files，16 passed。
- AI 默认确定性套件：25 files，87 passed，0 skipped。
- Agent 默认确定性套件：13 files，65 passed，0 skipped。
- Runtime AgentCore Turn Engine：15 passed。
- `bun run check:quick`：通过。
- `bun run check`：通过，包括 Biome、root/CLI/Desktop/Admin/Docs 类型检查和全部 guards。

## 10. 预期与实际

| 项目 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- |
| 类型所有权 | 从单体 `types.ts` 移到协议层 | 已完成，旧类型 exact alias | 符合 |
| 公共子路径 | 稳定协议可单独消费 | `@vetta/ai/protocol` 已导出 | 符合 |
| 事件穷尽性 | switch 可穷尽检查 | 12 分支 contract test | 符合 |
| 流有限终止 | iterator/result 均有限结束 | Phase 0 测试继续通过 | 符合 |
| 错误体系 | 建立稳定分类 | 分类完成，Provider 映射待 Phase 2/3 | 部分完成，符合分阶段边界 |
| usage unknown | 未知值不伪造为 0 | 旧 Provider 仍使用兼容数值 Usage | 延后到新 Adapter 协议，避免无来源迁移 |
| 新流失败通道 | iterator rejection | 旧流保持 error event 兼容 | 延后到 Phase 2 compat adapter |

## 11. 已完成与未完成

已完成：

- 稳定协议目录、公共子路径与根兼容 re-export。
- reasoning、usage、finish、message、tool、context、stream event 的单一类型所有权。
- 稳定结构化 AI error code 与基础错误类。
- EventStream 协议错误接入。
- Tool 参数 `any` 移除及 Bedrock JSON 边界校验。
- 协议 contract、type alias、穷尽 switch、错误字段和 JSON 边界测试。
- Agent 与 Runtime 关键差分回归。

未完成，进入 Phase 2：

- 新 `LanguageModelAdapter` 与 ModelStream 失败语义。
- 隔离的 Adapter Registry 与注册冲突策略。
- 受控 HTTP/SSE test transport。
- Provider conformance suite。
- Provider wire payload TypeBox 校验和结构化错误映射。
- nullable/unknown usage 在新协议中的精确表达。

## 12. 涉及文件

核心：

- `packages/ai/src/protocol/*`
- `packages/ai/src/types.ts`
- `packages/ai/src/utils/event-stream.ts`
- `packages/ai/src/index.ts`
- `packages/ai/package.json`
- `tsconfig.json`
- `packages/desktop-app/tsconfig.json`

边界与测试：

- `packages/ai/src/providers/amazon-bedrock/messages.ts`
- `packages/ai/test/protocol-contract.test.ts`
- `packages/ai/test/event-stream.test.ts`
- `packages/ai/test/amazon-bedrock-messages.test.ts`
- `packages/ai/test/stream.test.ts`
- `packages/agent/test/agent-loop-failure.test.ts`
- `packages/ai/CHANGELOG.md`
