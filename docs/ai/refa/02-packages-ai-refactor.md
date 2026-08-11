# `packages/ai` 重构方案

## 1. 当前问题

`packages/ai` 已经覆盖多个 Provider、OAuth、模型目录、请求转换和跨 Provider 消息，但模块边界仍主要依靠约定：

- 根 `index.ts` 广泛 `export *`，Provider 内部类型容易意外成为公共 API。
- `stream.ts` 同时承担 Provider 选择、环境凭据、选项映射和调用分发，新增 Provider 需要改中心文件。
- `types.ts` 同时包含消息、模型、工具、usage、事件和 Provider 选项映射，稳定协议与易变配置混在一起。
- Provider 文件结构不一致，有些已拆 request/messages/events，有些仍集中在单个大文件。
- 运行时入站校验不统一，部分 Provider 依赖类型断言和宽松对象访问。
- `EventStream` 缺少完整失败终态；生产者抛错或无结果结束时，消费者可能无法可靠结束或拿到 result。
- 一部分所谓 Provider 功能测试依赖真实凭据和网络，默认测试无法稳定证明全部 Provider 的共同契约。

## 2. 目标模块

### `protocol/`

只放 Provider 中立且需要长期稳定的内容：

- `message.ts`：system/user/assistant/tool 消息和内容块。
- `tool.ts`：模型可见工具描述、tool choice、tool call/result。
- `usage.ts`：input/output/cache/reasoning usage；未知值使用 `null`，不用虚构 `0`。
- `finish-reason.ts`：规范化原因与 Provider raw reason。
- `stream-event.ts`：内容块、metadata、usage、warning 和 finish 事件；失败通过 iterator rejection 表达。
- `errors.ts`：结构化错误基类和稳定 error code。

协议层不得导入具体 Provider SDK、Node API、OAuth 或应用类型。

### `models/`

- `model-descriptor.ts`：纯数据 `ModelDescriptor`。
- `model-catalog.ts`：查询、过滤和模型能力声明。
- `generated/`：脚本生成的数据，不混入运行逻辑。
- `capabilities.ts`：输入模态、reasoning、tool、context window 等规范化能力。

模型目录描述“模型是什么”，不描述“如何调用”。凭据、fetch、WebSocket 客户端不能进入 descriptor。

### `runtime/`

- `language-model-adapter.ts`：单次模型调用行为契约。
- `adapter-registry.ts`：按 API 标识解析 adapter factory。
- `model-binding.ts`：将 descriptor、凭据引用和调用选项绑定为一次调用快照。
- `stream-model.ts`：唯一公共流式调用原语。
- `collect-response.ts`：消费规范化事件得到完整 AssistantMessage。

建议契约：

```ts
interface LanguageModelAdapter {
  readonly api: Api;
  stream(request: ModelCallRequest): Promise<ModelStreamResponse>;
}

interface ModelStreamResponse {
  readonly events: AsyncIterable<ModelStreamEvent>;
  readonly responseMetadata?: Readonly<Record<string, unknown>>;
}
```

Adapter 只做一次模型调用。重试是否属于 Adapter，按错误发生位置区分：

- DNS、连接失败、429、可安全重放的空流：由 transport retry policy 处理。
- context overflow、工具执行失败、Agent step 重试：不得在 Provider 内处理。

### `provider-kit/`

包内共享能力：

- 注入式 `fetch` 和 Web 标准 Request/Response。
- SSE/JSON Lines/WebSocket 帧读取。
- abort 传播与响应 body 清理。
- 结构化 JSON 解析和 TypeBox 入站校验。
- 标准 HTTP 错误抽取、retry-after 解析和敏感字段清理。
- tool-call id、Unicode surrogate、usage 的通用规范化。

Provider-kit 不知道任何 Session、Agent 或产品 Feature。

### `providers/<provider>/`

每个 Provider 统一为：

```text
index.ts          仅导出 adapter factory 和公开选项
adapter.ts        实现 LanguageModelAdapter
request.ts        Provider 请求类型与转换
response.ts       非流式/公共响应 schema 和转换
stream.ts         流式 schema、状态机和事件转换
errors.ts         Provider 错误映射
auth.ts           仅该 Provider 需要的认证适配
fixtures/         脱敏 wire fixtures
```

不是每个 Provider 都必须机械创建全部文件；只有存在相应职责时才创建。统一的是职责，不是空目录。

### `testing/`

- `ScriptedLanguageModel`：按调用次序返回可控事件并记录 request。
- `createProviderTestTransport`：JSON、stream、empty、error、controlled stream。
- `providerConformanceSuite`：所有 Adapter 必须通过的功能矩阵。
- fixture builders：构造规范化消息和 wire chunk。

测试工具只通过 `@vetta/ai/testing` 条件导出，不能进入生产入口。

### `compat/`

保留旧 `stream()`、`Model<Api>` 和旧事件名的适配。兼容代码只允许依赖新模块，新实现禁止反向依赖 compat。

## 3. Registry 与扩展性

当前新增 Provider 需要修改选项映射、环境变量分支和 stream function map。目标改为显式注册：

```ts
interface ProviderRegistration<TApi extends Api> {
  readonly api: TApi;
  readonly createAdapter: (context: ProviderFactoryContext) => LanguageModelAdapter;
  readonly resolveCredential?: CredentialResolver;
  readonly mapOptions: (options: SimpleStreamOptions) => ApiOptionsMap[TApi];
}
```

内置 Provider 在 `register-builtins.ts` 一次性注册；测试可以创建隔离 registry，不能污染进程全局。注册冲突必须失败，不能静默覆盖。

长期扩展点分三层：

- Provider Adapter：API 协议差异。
- Transport：HTTP/WebSocket 和测试替身。
- Middleware：日志、trace、retry、脱敏；只包装单次模型调用，不修改 Session。

不引入任意 hook 列表。每个扩展点必须有明确输入、输出和错误语义。

## 4. 流式生命周期

规范化流必须满足：

1. 每个内容块都有稳定 id，并遵循 start -> delta* -> end。
2. 全流最多一个 `finish`，`finish` 后不能再有事件。
3. transport 或解析失败以 `error` 终态或 iterator rejection 表达，但同一调用只选择一种失败通道。
4. abort 必须让 iterator 和最终结果都在有限时间内结束。
5. 正常 EOF 但没有 `finish` 是协议错误，不得当作成功。
6. `collectResponse()` 必须在成功时 resolve，在失败时 reject，不能永久 pending。

建议内部选用“iterator rejection 表示失败，`finish` 表示成功”的单一规则；若为兼容 UI 需要错误事件，只在上层投影成观察事件。这样不会同时存在 error event 与 rejected result 两个相互竞争的终态。

## 5. 错误体系

最低分类：

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

每个错误包含稳定 `code`、`retryable`、可选 `statusCode`、`provider`、`modelId`、`requestId`、`cause` 和已脱敏 metadata。应用不通过错误 message 字符串做业务判断。

## 6. 公共 API

根入口只暴露：

- Provider 中立协议。
- ModelDescriptor/Catalog。
- `streamModel` 与 `collectResponse`。
- Provider 注册所需的最小类型。
- 稳定错误类型。

具体 Provider 的高级选项通过 `@vetta/ai/providers/<name>` 子路径导出。OAuth helper、request schema、stream parser 和测试 fixture 不从根入口导出。

## 7. 迁移顺序

1. 先写 stream terminal law、错误分类和 registry 契约测试。
2. 新建协议模块，旧类型通过 type alias 指向新类型，暂不改 Provider。
3. 引入 Adapter Registry，将现有 `streamFunctions` 包装为 registration。
4. 建立 provider-kit 和 mock transport，迁移一个简单 Provider 与一个复杂 Provider 做验证。
5. 建立 conformance suite 后逐个迁移其余 Provider。
6. 最后收窄根 exports，添加 deprecated 标记和迁移文档。

任何阶段都不允许同时大改全部 Provider；每个迁移批次必须保持相同规范化事件和错误行为。
