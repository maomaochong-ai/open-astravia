# Phase 3：Provider 迁移状态

## 阶段目标

把所有内置 Provider 从旧 `ApiProvider.stream()` 包装迁移为真正的 `LanguageModelAdapter`，并让每个协议族具备可离线运行的 wire fixture、入站 schema、错误映射和功能矩阵。Registry 中存在条目不等于完成迁移；只有 request、wire reducer、失败和取消都由新路径所有，才计为原生 Adapter。

## 当前总览

14 个内置 API 仍通过同一 `visitBuiltInProviders()` 同时注册 legacy provider 和新 Adapter。当前 9 个 API 已注册原生 Adapter：

- OpenAI-compatible：OpenAI Completions、NVIDIA、Qwen、DeepSeek、Z.ai、智谱。
- Responses：OpenAI Responses、Azure OpenAI Responses、OpenAI Codex Responses。

剩余 5 个 API 仍由 `adaptApiProvider()` 包装旧实现：

- Anthropic Messages。
- Google Generative AI、Gemini CLI、Vertex。
- Amazon Bedrock Converse Stream。

## 已实现

### Registry 与测试基础设施

- Registry 具备 API 一致性检查、重复注册失败、显式替换、来源卸载和隔离实例测试。
- `createProviderTestTransport()` 支持 JSON、SSE、controlled stream、HTTP error 和 request/signal 观察。
- OpenAI Completions 与 Anthropic 试点继续通过 14 个共享 conformance 场景。

### Phase 3A：OpenAI-compatible

- 6 个 API 共享原生 request builder、wire schema、stream parser 和 Provider error normalizer。
- 各品牌变体只负责不可变模型映射与 compat 配置，不复制 parser。
- 旧 `stream*()` 反向调用原生 Adapter，只保留 error-event 兼容语义。

详细记录见 [10-phase-3a-openai-compatible-native-adapters.md](./10-phase-3a-openai-compatible-native-adapters.md)。

### Phase 3B：Responses

- OpenAI、Azure、Codex Responses 已从 `adaptApiProvider()` 切到原生 Adapter。
- 三者共享按 `output_index` 管理并发 output item 的 reducer，文本、reasoning 和 function call 不再依赖单一 `currentBlock`。
- TypeBox 只校验不可信 wire event；内部 request、message 和状态对象继续使用 TypeScript 类型。
- 空流、缺失 `response.completed`/`response.incomplete`、未闭合 output item、乱序 delta、畸形 SSE/WebSocket JSON 都有限拒绝。
- `response.incomplete` 映射为成功的 `length` 终态；`response.failed`、HTTP error 和取消通过原生 rejection 表达。
- OpenAI/Azure SDK 接受注入式 `fetch`；Codex 的 endpoint、JWT account、SSE/WebSocket 和 session cache 仍属于独立 transport。
- 旧三个 `stream*()` 入口只通过共享 compatibility projector 把原生 rejection 投影回旧 `error` terminal event。

详细记录见 [14-phase-3b-responses-native-adapters.md](./14-phase-3b-responses-native-adapters.md)。

## 尚未实现

- Anthropic 当前已有 TypeBox wire pilot 和注入式 fetch，但 Registry 仍注册 legacy bridge，尚不能计作原生迁移。
- Bedrock 尚未与 Anthropic 形成共享的 Messages 语义边界；AWS SDK transport、usage/cache 和错误 metadata 仍需独立适配。
- Google/Vertex/Gemini CLI 尚未拆分认证、endpoint、retry 与 Gemini event reducer 的所有权。
- OpenAI SDK 和 Codex transport 仍各自保留内部 retry；统一 retry policy 尚未上移到 Runtime。
- live canary 因当前环境没有 Provider 凭据而未执行，不能用离线矩阵替代真实服务的 header、代理、连接关闭和限流验证。
- legacy registry 和公共 `stream*()` 仍有兼容消费者，删除受 Phase 7 发布周期约束。

## 设计取舍

- 按协议族共享 reducer，而不是按品牌复制 Adapter。认证和 endpoint 差异属于 transport，不进入事件状态机。
- TypeBox 只放在 Provider wire 入站边界；没有引入 Zod，也没有把运行时 schema 扩散到内部已类型化对象。
- native Adapter 使用 iterator/result rejection 作为唯一失败通道；旧 error event 只存在于单向 compatibility projector。
- 严格终止律优先于“尽量返回内容”：缺失 terminal 或 block 生命周期不完整时明确失败，避免上层把截断响应持久化成成功消息。
- Codex SSE 与 WebSocket 共用同一 reducer，但各自保留连接、复用和帧读取职责，避免 transport 状态污染协议状态。

## 验证

- Responses family 直接矩阵：1 个测试文件、41 条测试通过。
- 覆盖文本、usage、工具参数分片、交错 output item、incomplete、failed、HTTP error、wire schema、空流、缺失终态、调用前/流中 abort、默认 Registry、legacy 投影和 Provider 特有 request mapping。
- Codex WebSocket 覆盖成功、畸形 JSON、terminal 前关闭和流中取消。
- AI 默认全量、`bun run check:quick` 与根 `bun run check` 的最终数字记录在 Phase 3B 文档。

## 下一迁移入口

1. 把 Anthropic wire pilot 提升为原生 Adapter，并以共享 Messages 语义评估 Bedrock；不要让 AWS 认证或 SDK command 类型进入 reducer。
2. 再迁移 Google Generative AI、Vertex 和 Gemini CLI，先拆认证/endpoint，再共享 Gemini event reducer。
3. 所有协议族原生化后，上移统一 retry policy并移除 `adaptApiProvider()` fallback。
4. 满足 live canary 和两个锁步发布周期后，进入 Phase 7 收窄根 exports 与删除 legacy registry。
