# 方案迭代记录

本文不是时间流水账，而是记录每一轮的假设、反证和方案变更。最终实施应以本目录其他文档为准。

## 第一轮：从现有所有权出发

### 初始问题

如果只阅读 `packages/ai` 和 `packages/agent`，容易得出“把 Agent 类补全成完整运行时”的结论。但上游依赖检查表明，这会制造第二套 Runtime。

### 仓库事实

- `packages/runtime-core` 已拥有 `AgentSession`、`TurnPipeline`、`TurnEnginePort`、事件持久化、上下文策略、上下文检查点、steering/follow-up 队列、Feature 编译、工具策略和 Host Ports。
- 当前产品生产路径通过 `AgentCoreTurnEngine` 调用 `agentLoopContinue`，没有上层源码直接依赖 `packages/agent` 的 `Agent` 类。
- `packages/runtime-tools` 已被定义为通用工具和 Coding Tools Feature 的所有者。
- `packages/coding-agent` 是组合与产品特性层，不应重新拥有 Session 或 Provider 协议。
- `RuntimeSessionContextUsage` 当前只提供总 token、上下文窗口和百分比，无法回答系统提示词、skill、工具 schema、历史消息等各自占比。

### 第一轮方案

1. 将 `packages/ai` 收敛为 Provider 中立的模型调用层。
2. 将 `packages/agent` 收敛为无持久状态的 Turn 执行引擎。
3. 保持 `packages/runtime-core` 为唯一 Session Runtime。
4. 由 `runtime-core` 在 Model Call Frame 组装阶段记录上下文来源和 token 估算，应用只读取标准化报告。
5. 先包内模块化，再按真实发布需求拆包。

### 第一轮仍未解决的问题

- `packages/agent` 最终是保留独立公共包，还是在兼容期后合并到 `runtime-core`？
- Provider 入站数据统一采用 TypeBox、Zod，还是定义窄 schema 适配协议？
- Vercel AI SDK 的 Node/Edge 双环境测试、Mock Model 和 HTTP Test Server 哪些值得引入，哪些会过度建设？
- 新旧 Turn Engine 的差分比较以消息、事件还是持久化结果为主？

## 第二轮：Vercel AI SDK 反审

状态：已完成。

### 值得借鉴的部分

- Provider Specification 把核心调用和具体 HTTP API 隔开，使核心层可用 Mock Model 完整测试。
- `MockLanguageModelV4` 既能按调用序列返回预设结果，也记录实际调用参数；这比在 Agent 测试里 mock `stream()` 的内部细节稳定。
- 统一 Test Server 能控制 JSON、二进制、分块流、空响应、HTTP 错误和中途 abort，并记录真实 Request。
- Provider 对未知响应使用运行时 schema 校验，而不是直接类型断言。
- `*.test-d.ts` 单独保护工具输入推导、可选字段和泛型 API，避免“运行正确但类型退化”。
- Node 与 Edge 测试配置分开，明确了哪些代码依赖 Node，哪些只依赖 Web 标准。

### 不应照搬的部分

- Vercel 同时兼容 Zod 3、Zod 4、Standard Schema、自定义 JSON Schema 和 lazy schema，是公共 SDK 生态兼容需求，不是 Vetta 当前需求。
- Provider v2/v3/v4 长期并存形成了明显的协议维护成本。Vetta 应采用内部迁移窗口，而不是永久保留多个协议世代。
- `ToolLoopAgent` 单文件存在大量 generate/stream 对称测试和参数透传测试，覆盖很广，但重复度高。Vetta 应共享场景矩阵，只对真正不同的路径分开测试。
- 大型 inline snapshot 适合保护 Provider 请求形状，不适合保护频繁调整的内部对象。应优先断言语义字段，协议快照只用于稳定 wire contract。
- 全量 Node/Edge 双跑对本仓库没有直接收益。只对声明为 Web 标准兼容的 `protocol` 和 `provider-kit` 双跑。

### 第二轮对第一轮的修正

1. 不把行为方法放入可序列化 `ModelDescriptor`。目录和 IPC 使用 descriptor，模型调用时由 registry 解析成 `LanguageModelAdapter`。
2. 不创建支持任意 schema 库的 `FlexibleSchema`。内部协议使用 TypeBox；Zod 只留在复杂配置边界。
3. 不同时维护独立 generate 和 stream 实现。以规范化 stream 为唯一原语，collect helper 派生完整结果。
4. 建立 deterministic provider conformance suite，现有真实凭据测试转为单独 canary。
5. `provider-kit` 先作为包内模块，不立即发布成 workspace 包。

## 第三轮：长期迁移与维护反审

状态：已完成。

### 新发现

- `coding-agent` 对 `@vetta/agent-core` 的大量依赖主要是 `AgentMessage`、`ThinkingLevel`、`ToolPhase`、`AgentEvent` 等共享类型，而不是执行循环。
- `ThinkingLevel` 在 `packages/ai` 与 `packages/agent` 已存在重复定义。
- `ToolPhase` 被 Runtime 事件和 Session 文档使用，实际所有者不是 Agent Engine。
- `AgentMessage` 混合模型消息与 UI/扩展自定义消息，使模型协议、Session 协议和产品扩展互相耦合。
- Coding Agent 已有结构化 `SystemPromptDraft` 和逐 block `SystemPromptDiagnostics`，但 Composer 最后将它们压成一个 instruction，并通过 callback 副通道上报，Runtime 看不到正式 provenance。

### 最终修正

1. 保留 `@vetta/agent-core` 包，作为 Runtime 与 AI 之间的无状态执行引擎边界；不把它并入已很复杂的 `runtime-core`。
2. 现有有状态 `Agent` 移到显式 standalone 兼容子路径，根入口停止导出。至少两个锁步发布周期后，如无真实外部消费者则删除 standalone；`agent-core` 包本身继续保留。
3. 将共享类型按所有权迁移：模型消息和 reasoning 到 `@vetta/ai/protocol`，Session/observation 到 `runtime-core`，工具定义和进度到 Runtime Tool 层。
4. Agent Engine 只接受模型可见 `Message[]`；自定义 Session entry 在 Runtime 投影阶段处理，不再通过 `AgentMessage` 进入模型循环。
5. 上下文组成报告成为 `ModelCallFrame`/最终调用准备的正式只读产物。现有 Prompt diagnostics 提供 system prompt 明细，Runtime 再补 tools、history、runtime context 和 user input。
6. 兼容 Adapter 必须有 owner、删除条件和禁新增调用 guard；没有退出条件的 Adapter 不允许进入迁移方案。

### 三轮后的最终判断

- Vercel 的价值主要是测试基础设施和 Provider 契约思想，不是目录数量或 schema 全兼容。
- 这次重构必须同时调整上游类型所有权，否则只能得到更整齐的内部目录，得不到更低的维护成本。
- 优先修协议终态和测试基础设施，再移动代码；不能先全量改目录后补测试。
- 上下文占比功能可实现，而且当前 Prompt diagnostics 已覆盖一部分基础，但完整实现必须发生在 Runtime 最终调用边界。

## 被否决的方向

- 把 Session、持久化和队列重新放进 `packages/agent`：与 `runtime-core` 重复。
- 立即拆出多个 Vercel 风格 workspace 包：发布和兼容成本大于收益。
- 在 AI/Agent 同时引入 Zod 与 TypeBox：制造 schema 多源。
- 让 Desktop 自行解析 prompt 计算占比：不同宿主结果不一致，并泄漏底层结构。
- 用 Provider 总 input token 按比例回填各区块“精确值”：没有事实依据。
- 永久保留 legacy/new 两套 engine：差分测试只能用于迁移窗口。
