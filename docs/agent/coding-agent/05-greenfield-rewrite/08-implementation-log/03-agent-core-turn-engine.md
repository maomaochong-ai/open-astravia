# 实施日志：Agent Core Turn Engine Adapter

本文件记录 Agent Core Turn Engine Adapter 的实施与验证。

## 2026-07-26：Agent Core Turn Engine Adapter

### 目标

让新 Kernel 的 Execution 阶段使用现有 `@vetta/agent-core` 模型与 Tool Loop，同时保持依赖方向和运行快照边界：

- `runtime-core -> agent-core -> ai`。
- `agent-core` 不知道 Session、Repository、Feature 或 Coding 产品。
- 模型和 Stream 实现由组合根注入。
- 工具权限、执行和取消仍属于 Runtime 合同。

### 分析结论

原 `RuntimeToolDefinition` 只有名称、描述和 Schema，无法执行真实 Tool，也没有统一位置执行 `ToolPolicy`。直接把 `AgentTool` 放进 Snapshot 会让 Kernel 合同绑定 `agent-core` 的工具类型。

本轮采用的边界是：

```text
RuntimeToolDefinition（中立合同）
-> AgentCoreTurnEngine（唯一适配点）
-> AgentTool（agent-core 内部合同）
```

Runtime Tool 自身提供执行函数，但不依赖具体 Tool 实现、MCP SDK 或 Coding Session。适配器在调用执行函数前统一执行 Snapshot 的 `ToolPolicy`。

### 修改范围

- 新增 `AgentCoreTurnEngine`：
  - 使用 `agentLoopContinue()`，因为 Turn Pipeline 已经完成输入消息组装。
  - 将 Snapshot Instruction 按确定顺序组合成 System Prompt。
  - 将准备后的标准消息复制到 agent-core Context。
  - 将 Runtime Tool 转换为 Agent Tool。
  - 只把完成的 Assistant 和 Tool Result 映射为 `TurnEngineEvent.message`。
  - 从最后一条 Assistant 消息映射唯一 `completed` 终止事件。
  - 透传 Session ID、模型 Stream 参数、动态 API Key 和取消信号。
- 扩展 Runtime Tool 合同：
  - `label`。
  - `execute()`。
  - Session、Turn 和 Tool Call 标识。
  - `AbortSignal`。
  - 进度与阶段回报。
- Feature Compiler 对 Tool JSON Schema 改为深拷贝并递归冻结。
- 新增架构守卫：
  - `agent-core` 禁止导入 `runtime-core`。
  - `agent-core` 禁止导入 `coding-agent`。

### Tool 执行语义

```text
模型产生 Tool Call
-> agent-core 校验参数
-> AgentCoreTurnEngine 调用 ToolPolicy.authorize
-> 允许：调用 RuntimeToolDefinition.execute
-> 拒绝或执行抛错：agent-core 生成 isError Tool Result
-> Tool Result 进入下一次模型调用
```

Policy 拒绝不会调用工具实现，也不会直接中断整个 Tool Loop；模型能看到标准错误 Tool Result 并决定如何继续。

### 明确未修改

- 未切换旧 `RuntimeHost`、Desktop、CLI、RPC 或 IM。
- 未迁移旧 Coding Tools。
- 未启用 steering、follow-up 或输入队列。
- 未把流式 text/thinking delta 加入 Kernel 事实事件。
- 未改变旧 `@vetta/agent-core` 的 API 或 Tool Loop。
- 未把 Model Registry 或具体 Provider 放进 Runtime Snapshot。

### 测试

- `packages/runtime-core`
  - `bun run test`
  - 4 个测试文件、21 个测试通过。
- `AgentCoreTurnEngine`
  - Runtime Instruction、消息和 Stream 参数映射。
  - 两次录制模型流驱动的真实 Tool Loop。
  - Tool Policy 请求和 Runtime Tool 执行。
  - Policy 拒绝不调用工具实现，并产生错误 Tool Result。
  - AbortSignal 透传及 aborted 终止映射。
- 质量守卫
  - `bunx vitest --run scripts/quality/quality-gates.test.mjs`
  - 21 个测试通过。
- 包级类型检查
  - `bunx tsgo --noEmit -p tsconfig.build.json`
  - 通过。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- 新 Kernel 已不再只依赖 Fake Engine，可以使用现有 agent-core 执行录制模型流和真实 Tool Loop。
- Tool Policy 只有一个执行入口，不需要 Coding Tool、MCP Tool 分别实现权限检查。
- Runtime Tool 不依赖 `agent-core` 类型，后续 Coding、MCP 和 Plugin Tool 可以实现同一合同。
- Tool Schema 的嵌套对象和数组不能在 Snapshot 发布后被外部修改。
- `agent-core` 与 Runtime/Product 的反向依赖由自动守卫阻止。

### 未解决问题

- Kernel 事件目前只承载完成消息，尚未定义流式 UI Observation Event。
- 当前 Engine 实例绑定一个模型；多模型选择应由组合根创建对应 Engine，不能重新引入全局 Model Registry。
- Tool progress 和 phase 已能进入 agent-core，但 Kernel 尚未向 Host 暴露对应观察事件。
- 旧生产 RuntimeHost 仍未使用新 Pipeline。

### 下一步

1. 在 `runtime-tools` 建立第一个不依赖 `coding-agent` 的 Coding Tools Feature，并通过真实 Engine 合同测试。
2. 为 Conversation Repository 增加 Snapshot 加载与恢复。
3. 实现旧会话格式只读 importer。
4. 再设计跨进程会话 owner/lock 合同。
