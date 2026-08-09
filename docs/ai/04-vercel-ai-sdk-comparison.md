# 与 Vercel AI SDK 的多维对比

## 一句话结论

Vercel AI SDK 在“公共 SDK 的分层、协议稳定性和生态扩展”上明显更成熟；Vetta 在“桌面 coding agent 的长期会话控制和特殊认证/协议适配”上更贴近产品。Vetta 应借鉴前者的边界和合同，不应照搬其整体规模。

## 架构边界

| 维度 | Vetta | Vercel AI SDK | 判断 |
| --- | --- | --- | --- |
| Provider 协议 | 与公共消息、模型 DTO 和流类同包 | 独立、版本化 `LanguageModelV4` | Vercel 更适合稳定生态 |
| Provider 公共工具 | 分散在各实现和少量 utils | 独立 `provider-utils` | Vercel 更能统一安全与错误语义 |
| Provider 发布 | 多个 Provider SDK 集中在一个包 | 每个 Provider 独立包 | Vercel 隔离、tree-shaking 和升级更好 |
| 模型目录 | 内建 generated registry | 通常由 Provider/网关或调用者决定 | Vetta 更适合统一模型选择 UI，但耦合更高 |
| Agent | 长会话对象 + loop | 薄 Agent facade + 强大的 generate/stream core | 产品目标不同 |
| 全局状态 | API Registry、HTTP dispatcher | Provider 实例显式创建 | Vercel 可测试性和隔离性更好 |

## 类型与运行时验证

Vercel 的 Provider options 使用 Provider 命名空间，具体 Provider 再用 schema 解析；Provider 输出也通过 schema 化 response handler。ToolSet 的名称、输入和结果类型贯穿生成、事件、回调和 Agent。

Vetta 使用 TypeBox 定义工具 schema 是正确方向，但在 Registry、tool call、event 和 proxy 边界大量退化为 `any` 或类型断言。更关键的是，浏览器扩展会直接跳过验证。

对照仓库在所抽查的 `packages/ai`、`provider-utils` 和 `openai` 中有 36 个 `.test-d.ts` 类型测试；Vetta 两个包目前没有类型测试。对公共泛型 API 来说，类型测试应视为合同测试，而不是锦上添花。

## 流式协议

### Vetta

- 使用自定义 push queue，消费方式简单。
- 每个 delta 都携带完整 `partial`，UI 接入方便，但事件体和代理带宽较大。
- terminal error 被表示成 assistant message，而不是 rejected operation。
- 没有 failure channel、背压、标准取消和 incomplete stream 检测。

### Vercel

- Provider 只输出语义 stream parts，上层负责聚合结果。
- start、response metadata、warning、finish、raw chunk 和 error 分开。
- 工具输入 start/delta/end 与已解析 tool call 分开，避免把不完整 JSON 假装成已验证输入。
- 复杂度显著更高，但协议表达力和诊断能力更强。

Vetta 不必复制所有 stream part；至少应补齐 `warnings`、`response metadata`、结构化 error 和 terminal invariant。

## Provider 扩展成本

Vetta 新增 Provider 需要同时处理核心类型、实现、stream registry、模型生成、环境变量、coding-agent 默认模型、README 和大量跨 Provider 测试。完整接入面横跨多个包，说明扩展点还不是独立单元。

Vercel 新 Provider 通常实现稳定 Provider spec，并复用 `provider-utils`；具体包可以独立版本、测试和依赖。代价是必须理解严格协议，初次接入代码更多。

适合 Vetta 的折中方案：

- 先在 `packages/ai` 内部形成 provider contract 与 provider-utils 边界。
- Provider 通过显式 factory 注册。
- 只有当独立依赖、发布或浏览器 bundle 确实需要时，再拆 workspace 包。

## 错误与可运维性

Vercel 的 `APICallError` 保存 URL、status、headers、response body、Provider data 和 `isRetryable`，并通过全局 Symbol marker 支持跨包版本识别。response handler 统一处理空 body、无效 JSON、schema 错误和响应大小。

Vetta 的错误多数在 Provider 内临时拼接字符串，最终常进入 `AssistantMessage.errorMessage`。这种方式对 UI 直接显示很方便，但会丢掉重试、指标聚合和故障分类所需的数据。

建议采用“双层表示”：结构化内部错误用于策略与 telemetry，单独的本地化 presentation mapper 生成用户文案。不要让 Provider 错误字符串成为业务合同。

## 工具与 Agent Loop

Vercel 已提供默认 20 步上限、可组合 stop conditions、每步和每工具 timeout、工具审批、输入修复、active tools、稳定工具排序和并发执行。其 ToolLoopAgent 自身很薄，复杂逻辑集中在被广泛复用和测试的生成核心。

Vetta 的强项是循环中的宿主交互：工具后 steering、自然结束后的 follow-up、动态工具、上下文持久化检查点。对照仓库没有直接覆盖这些会话级需求。

建议分层：

```text
AgentSession（Vetta 特有）
  - messages / queues / subscriptions / persistence
  - starts AgentRun

AgentRun（吸收成熟 loop 合同）
  - stop policy / timeout / tool execution / structured result
  - no durable mutable state

LanguageModel Adapter
  - provider protocol only
```

## Browser、Edge 与依赖

Vercel 的核心和 Provider 工具明确运行 Node 与 edge 测试，包声明 `sideEffects: false`，Provider 依赖按包隔离。

Vetta README 宣称支持浏览器，但根 `@vetta/ai` 直接依赖多套 Node/Provider SDK，根导出暴露大部分 Provider，并在导入流 API 时注册全部 Provider、修改 Node 全局 dispatcher。代码中已有动态 import 来规避部分 Node 模块问题，说明当前边界依赖 bundler 行为和人工约定。

这不等于浏览器一定不能运行，但意味着“浏览器兼容”不是由包结构保证的。应增加浏览器 smoke bundle 和运行测试，并提供无副作用 browser-safe 入口。

## 测试策略

| 测试类型 | Vetta | Vercel AI SDK | 建议 |
| --- | --- | --- | --- |
| Provider 真实 E2E | 较多，凭据不足时跳过 | 以 mock/fixture 为主，另有生态验证 | 两者结合 |
| 请求/响应 fixture | 已有但不统一 | Provider 内大量 snapshot/fixture | 扩大离线覆盖 |
| 跨 Provider handoff | Vetta 有明确专项 | 上层协议天然覆盖较广 | 保留 Vetta 优势 |
| 类型测试 | 无 | 大量 `.test-d.ts` | 优先补公共 API |
| Node/edge 矩阵 | 未形成统一脚本 | 多包同时跑 node/edge | 先给 browser-facing 路径增加 |
| 流终止合同 | 缺失 | 上层大量覆盖 | 立即补齐 |

## 不应照搬的部分

1. 不要立即拆成与 Vercel 相同数量的包。当前团队和生态规模不需要同等发布矩阵。
2. 不要丢弃可序列化 `Model` DTO。桌面 IPC 和模型管理需要它。
3. 不要用一次性 `ToolLoopAgent` 替换长期 `Agent` 会话控制器。
4. 不要一次引入 Vercel 全部 UI stream、structured output、media、workflow 和 provider spec 版本历史。
5. 不要为了泛型完整度复制极高的类型复杂度。优先保护 `api -> options` 和 `tool name -> input/result` 两条关键关联。

## 可以直接借鉴的部分

1. 版本化、无 UI 状态的 Provider contract。
2. 统一 response handler、schema parser、安全 JSON、SSE、retry 和 error taxonomy。
3. Provider factory 显式注入 fetch、headers、base URL 和认证。
4. warning、provider metadata、request/response metadata 和 raw usage。
5. Agent 默认停止条件、timeout、工具审批和正式类型测试。
