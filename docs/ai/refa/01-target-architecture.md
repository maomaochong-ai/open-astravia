# 目标架构与职责边界

> 三轮分析后的最终目标架构。

## 1. 设计目标

目标不是让目录看起来更整齐，而是建立以下长期约束：

- Provider 差异不能泄漏到 Agent、Runtime 或应用。
- Session 生命周期只能有一个所有者。
- 同一个 Model Call 的 prompt、tools、usage、错误和终止原因必须可以追踪。
- 新增 Provider 主要增加适配代码和一致性测试，不修改核心分发器的大量分支。
- 新增 Agent Feature 通过贡献接口进入 Frame，不直接修改模型循环。
- Desktop、CLI 等应用只依赖 Runtime Host Port，不理解底层 Provider 事件。
- 公共协议稳定，产品策略可替换，具体 Provider 快速演进。

## 2. 目标依赖方向

```text
desktop-app / cli-app / other hosts
                 |
                 v
          runtime-core host ports
                 |
                 v
     runtime-core session + turn pipeline
          |                    |
          v                    v
 stateless agent engine    runtime-tools/features
          |
          v
      ai public facade
          |
          v
 provider protocol -> provider adapters -> HTTP/SSE/WebSocket
```

依赖只能向下。禁止出现以下反向依赖：

- `packages/ai` 依赖 Agent 或 Runtime。
- `packages/agent` 依赖 `runtime-core`、应用或 Coding Feature。
- `runtime-core` 依赖 `coding-agent` 或具体 UI。
- Provider 直接发布 Session Event。
- Desktop 直接解释 Provider 原始 chunk。

## 3. 包级职责

### 3.1 `packages/ai`

负责：

- Provider 中立的消息、内容块、工具调用、usage、finish reason 和流式事件协议。
- 可序列化的模型描述与模型目录查询。
- 模型运行适配器和 Provider 注册。
- Provider 请求转换、响应校验、流式解析和错误归一化。
- Abort、重试边界、上下文溢出分类等单次模型调用语义。

不负责：

- 多步工具循环。
- Session 历史、持久化、compaction 或 steering。
- 工具授权策略和产品工具集合。
- Desktop/CLI 状态。

### 3.2 `packages/agent`

负责：

- 单个 Turn 内的模型-工具循环。
- 工具参数校验、工具执行调度和工具结果回填。
- Step/Run 的终止预算与明确的停止原因。
- 将模型事件转换为无持久状态的 Agent 执行事件。
- 测试用 Scripted Model 和 Agent 场景测试工具。

不负责：

- Session 身份和跨 Turn 状态。
- ConversationRepository 或任何持久化。
- Feature 编译、上下文压缩、steering/follow-up 队列。
- 应用事件、窗口状态或 IPC。

现有 `Agent` 类暂时作为 standalone 兼容门面；生产 Runtime 不应通过它持有第二份状态。

最终保留 `@vetta/agent-core` 包本身，因为它是可独立测试的无状态执行边界。根入口只导出 engine API；有状态 `Agent` 迁到 `@vetta/agent-core/standalone` 兼容子路径，并按退出条件删除。

### 3.3 `packages/runtime-core`

继续作为唯一 Session Runtime，负责：

- Session 和 Turn 生命周期、互斥、取消和恢复。
- Conversation 持久化与事件事实。
- Feature 编译、Context Provider、Model Call Frame 和快照。
- 上下文准备、压缩、checkpoint 和重试决策。
- steering/follow-up 输入队列。
- 工具策略授权和 Host Port。
- 面向应用的状态投影、usage 和上下文组成报告。

`TurnEnginePort` 是 Runtime 与 Agent Engine 的唯一执行边界。长期应把 `AgentCoreTurnEngine` 从“字段翻译器”简化为稳定端口实现，不能继续复制上下文和工具语义。

### 3.4 `packages/runtime-tools`

负责：

- Runtime Tool 定义和产品无关的通用工具。
- Coding Tools Feature 及其动态贡献。
- 工具输入 TypeBox schema 和 schema 派生输入类型。
- 工具执行适配，但不绕过 Runtime ToolPolicy。

### 3.5 `packages/coding-agent`

负责：

- Coding Agent Profile、Feature 组合和宿主接线。
- 模型选择策略与 Coding 产品默认值。
- 文件、Shell、MCP、skill 等特性的贡献实现。

不再直接理解 `packages/agent` 内部循环，也不把 `AgentCoreTurnEngineOptions` 当作长期公共配置类型。组合层最终只注入 `TurnEnginePort`、模型目录和 Runtime Feature。

### 3.6 应用层

`desktop-app`、`cli-app` 和其他宿主只通过 `runtime-core` 的 Host Ports 访问：

- Session 控制。
- 事件与状态。
- 模型选择。
- 上下文 usage 和组成报告。
- 工具、后台任务和用户交互能力。

应用层不自行重算 token，也不解析 system prompt、skill 或工具 schema；否则不同宿主会产生互相矛盾的统计。

## 4. 包内模块划分优先于拆包

第一阶段在 `packages/ai/src` 内形成以下边界：

```text
protocol/          Provider 中立类型、事件、错误和终止契约
models/            可序列化 ModelDescriptor 与 Catalog
runtime/           resolve/bind/stream 单次调用编排
provider-kit/      HTTP、SSE、JSON 校验、认证和转换公共件
providers/<name>/  具体 Provider Adapter
testing/           Mock Model、scripted stream、conformance harness
compat/            旧 stream/types/exports 兼容面
```

`packages/agent/src` 内形成：

```text
engine/            无状态 runTurn 和 step loop
tools/             参数校验、执行、结果规范化
control/           stop budget、abort、checkpoint 协议
events/            Agent 执行事件和终止契约
testing/           Scripted Model 与场景 DSL
compat/            Agent 类和旧 loop API
```

只有满足至少一项条件才新建 workspace 包：

- 有两个以上不依赖 `packages/ai` 门面的独立消费者。
- 需要独立发布或独立版本兼容。
- 需要不同运行时依赖，例如纯协议包必须不带 Node 依赖。
- 包内依赖规则无法通过 exports 和 lint guard 可靠维持。

因此第一阶段不直接创建 `@vetta/ai-provider`、`@vetta/ai-provider-utils` 等包。Vercel 的多包结构服务于公共 Provider 生态，不能仅因目录相似就复制。

## 5. 稳定协议与可变实现

### 稳定层

- Provider 中立消息和内容块。
- `LanguageModelAdapter` 调用契约。
- 流式事件的顺序与终止规则。
- 错误 code、retryable、cause 和 Provider metadata。
- `TurnEnginePort` 及其 terminal event 规则。
- Runtime Host Ports。

模型信息拆成两种对象：

- `ModelDescriptor`：纯数据、可序列化，可用于目录、设置、IPC 和持久化。
- `LanguageModelAdapter`：行为对象，只存在于模型调用进程，通过 `(api, provider, modelId)` 从 registry 解析。

禁止把函数、客户端或凭据放进 `ModelDescriptor`，也禁止应用通过 descriptor 直接选择 Provider 实现。

共享类型按语义所有权归属：

- 模型 Message、ReasoningEffort、usage、tool-call wire types：`@vetta/ai/protocol`。
- Agent step/run event：`@vetta/agent-core`。
- Session event、RuntimeMessageEnvelope、ToolPhase observation：`@vetta/runtime-core`。
- RuntimeToolDefinition 及通用工具实现：`runtime-core` 契约与 `runtime-tools` 实现。

上层不得为了获得一个通用枚举而依赖 Agent 根入口。

### 可变层

- Provider 请求字段和鉴权方式。
- 模型目录抓取与生成策略。
- Prompt/工具贡献的具体实现。
- Context Strategy 和 compaction 算法。
- UI 展示。

稳定层必须有契约测试和兼容策略；可变层用实现测试和功能测试保护，不承诺内部文件结构。

## 6. 上下文组成可观测性

详细上下文占用不能只在 Desktop 渲染前临时计算。建议在 `runtime-core` 的 Model Call Frame 组装过程中产生不可变报告：

```ts
interface ContextCompositionReport {
  callId: string;
  model: { provider: string; id: string; contextWindow: number };
  estimate: { tokens: number | null; knownTokens: number; coverage: "complete" | "partial" | "none" };
  sections: readonly ContextSectionUsage[];
}

interface ContextSectionUsage {
  id: string;
  kind: "instruction" | "tool_schema" | "history" | "runtime_context" | "user_input";
  category?: string;
  sourceId?: string;
  estimatedTokens: number | null;
  characters?: number;
}
```

关键约束：

- 每个 `InstructionBlock`、Tool 和 Context Provider 在贡献时携带稳定来源标识。
- 统计针对“最终发送给模型的 Frame”，不能针对贡献前的原始数据。
- Provider 返回的 input usage 作为总量校准值，不能假装它能反推出各区块精确 token。
- 分区数字必须标记为 estimate；总 usage 同时保留 estimated 和 provider-reported 两套值。
- Host Port 对外提供最后一次调用和当前待调用 Frame 的报告，Desktop 只负责展示。

完整字段与未知值汇总语义见 [06-context-observability.md](./06-context-observability.md)。

## 7. 最终架构决策

- 保留可序列化 descriptor，通过 registry 解析 adapter。
- `provider-kit` 先包内模块化，不立即拆 workspace 包。
- 不做 Zod/TypeBox/Standard Schema 全兼容抽象。
- 模型调用只实现一个规范化 stream，完整结果由 collect helper 生成。
- Node 是主测试环境；只有 `protocol`、schema/value 校验和 Web 标准 transport helper 进入选择性的 Edge/Browser 兼容套件。

- `@vetta/agent-core` 继续存在，但只保留无状态 engine。
- standalone `Agent` 至少兼容两个锁步发布周期；仓库内调用清零、迁移文档完成、外部消费者核查完成后，在 breaking minor 删除。
- 上游先迁共享类型，再替换 Turn Engine；避免在新引擎上继续携带旧的类型所有权。
