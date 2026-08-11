# Phase 3：Provider 迁移状态

## 阶段目标

把所有内置 Provider 从旧 `ApiProvider.stream()` 包装迁移为真正的 `LanguageModelAdapter`，并让每个协议族具备可离线运行的 wire fixture、入站 schema、错误映射和功能矩阵。Registry 中存在条目不等于完成迁移；只有 request、wire reducer、失败和取消都由新路径所有，才计为原生 Adapter。

## 当前总览

14 个内置 API 仍通过同一 `visitBuiltInProviders()` 同时注册 legacy provider 和新 Adapter。当前 14 个 API 已全部注册原生 Adapter：

- OpenAI-compatible：OpenAI Completions、NVIDIA、Qwen、DeepSeek、Z.ai、智谱。
- Responses：OpenAI Responses、Azure OpenAI Responses、OpenAI Codex Responses。
- Messages/Converse：Anthropic Messages、Amazon Bedrock Converse Stream。
- Google：Google Generative AI、Gemini CLI、Vertex。

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

### Phase 3C：Anthropic/Bedrock

- Anthropic 与 Bedrock 已切换为原生 Adapter，失败/取消使用 rejection，旧 stream 只做单向兼容投影。
- 两个协议分别使用显式状态机；不强行共享 start/delta/stop 顺序不同的 wire reducer。
- Anthropic 保留 cache control、OAuth tool casing、thinking signature 和 adaptive thinking。
- Bedrock 通过 Adapter 构造注入 command sender 进行离线测试，AWS SDK client 不进入公共 `StreamOptions`。
- TypeBox 校验 wire event；Bedrock streamed exception 与 `$metadata.httpStatusCode` 进入稳定错误分类。

详细记录见 [15-phase-3c-anthropic-bedrock-native-adapters.md](./15-phase-3c-anthropic-bedrock-native-adapters.md)。

### Phase 3D：Google

- Google Generative AI、Vertex 与 Gemini CLI 已切换为原生 Adapter；内置 Registry 不再使用 fallback。
- 三种入口共享 TypeBox response schema、Gemini event reducer、usage 与严格终止律；API key、ADC 和 Cloud Code OAuth/retry 仍由独立 transport 所有。
- 官方 Gemini/Vertex 的 cached input 不再重复计入 `input`；Cloud Code 非重试型 4xx 不再误重试且保留 HTTP status。
- 顶层 provider 文件已收敛为轻量 facade，SDK sender/fetch 可离线注入。

详细记录见 [16-phase-3d-google-native-adapters.md](./16-phase-3d-google-native-adapters.md)。

## 尚未实现

- Anthropic server tools/citation/context management 与 Bedrock output image/tool-result 尚未进入统一公共内容协议，本阶段只保持已有能力并严格跟踪其 wire 生命周期。
- Google partial function arguments、server tools、grounding、URL context 与 inline output 尚未进入统一公共内容协议。
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
- Anthropic/Bedrock 直接矩阵：1 个测试文件、20 条测试通过。
- Google 直接矩阵：1 个测试文件、15 条测试通过；合并既有 Google 回归为 7 个文件、29 条通过。
- 覆盖文本、thinking/signature、usage/cache、工具参数分片、交错 output item、incomplete、failed、HTTP/AWS metadata error、wire schema、空流、缺失终态、调用前/流中 abort、legacy 投影和 Provider 特有 request mapping。
- Codex WebSocket 覆盖成功、畸形 JSON、terminal 前关闭和流中取消。
- AI 默认全量、Agent 上游、`bun run check:quick` 与根 `bun run check` 的最新数字记录在 Phase 3D 文档。

## 下一迁移入口

1. 在 Runtime 设计统一 retry policy、attempt budget 与 telemetry，再逐 Provider 移除内部 retry。
2. 为 server tools/citations/grounding/compaction 等新内容类型单独设计公共协议，不能在 Provider reducer 中静默伪装为文本。
3. 完成具备凭据的 live canary，并持续验证所有内置 API 都走原生 Registry 路径。
4. 满足两个锁步发布周期后，进入 Phase 7 收窄根 exports、删除 legacy registry 与 `adaptApiProvider()`。
