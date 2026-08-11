# 第 65 轮：Session-local Plugin Tool Runtime、动态撤销与同 Turn Effect

## 目标

本轮把既有 `AgentPluginToolContribution` 迁入 Greenfield 并行运行时，但不改变 Plugin Tool 的业务
协议，也不把 Plugin Tool 写入共享全局 Registry。

成功标准：

1. 每个 Session 独立读取、编译和调用自己的 Plugin Tool。
2. 保留旧实现的激活、优先级、调用参数、超时、结果和 Card 语义。
3. 工具执行前允许宿主撤销贡献，不执行已经删除或换 handler 的旧闭包。
4. 工具返回的 Prompt、Tool 和 Continuation effect 在同一 Turn 后续模型调用生效。
5. Agent Core、Coding Agent 和 CLI 三层都有可执行测试，完整类型门禁通过。

## 架构判断

### 为什么不是普通 Feature 或共享 Tool Registry

Plugin Tool 是动态的 Session 能力：

- 不同 Session 可以绑定不同 Plugin 配置和调用 bridge。
- 配置可能在一次 Session 运行期间增加、删除或替换。
- Plugin Tool 和内置工具、MCP 工具有既有的覆盖优先级。
- Plugin Tool effect 需要提交给当前 Session、当前 Turn 的 Run Orchestrator。

如果把它注册进 CLI 共享 `RuntimeToolRegistry`，会把 Session 生命周期、Plugin handler 和全局目录
绑定在一起，并造成跨 Session 泄漏。因此本轮把它实现为 Coding Agent Composer 前的
`Session-local Plugin Tool Runtime`：

```text
Feature 候选 Frame + 受保护的基础 Tool Catalog
  -> Session-local Plugin Tool Surface
  -> Plugin Tool Policy
  -> Plugin Run Orchestrator Effect Replay
  -> 最终 Model Call Frame
```

Runtime Core 仍然只认识 `RuntimeToolDefinition`、消息和 Frame，不认识 Plugin。

### 为什么工具执行上下文需要消息

旧 Plugin Tool 可声明：

```text
context.conversation = "messages"
```

工具调用发生时，消息视图必须包含触发调用的 Assistant Tool Call。原 Agent Tool 执行上下文只有
`phase()`，无法复刻该合同。本轮给通用 `ToolExecutionContext` 增加可选只读 `messages`：

- Agent Loop 在调用工具时传入当前完整消息副本。
- Runtime Core Adapter 只筛选标准 `Message`，再写入通用 `RuntimeToolExecutionRequest.messages`。
- Plugin Runtime 消费该字段；缺失时回退到模型调用前上下文。

字段保持可选，既有直接调用工具的适配器不需要伪造消息，也没有 Plugin 类型进入 Agent Core。

## 实施内容

### 1. 新增 Session-local Plugin Tool Runtime

新增 `CodingAgentPluginToolRuntime`，每次模型调用：

1. 读取最新 `AgentPluginRuntimeConfig`。
2. 以工具名归并贡献，同名贡献保持旧实现的“后注册者胜出”。
3. 按 explicit 或 `scope_use + requires + agent_mode` 选择 Plugin Tool。
4. 应用 `toolPolicyContributions`，顺序仍为每项 `allow` 后 `deny`。
5. 生成当前调用的 active tools 和完整 available tools。

显式工具列表继续绕过 scope、requires 和 agent mode；`additionallyEnabledToolNames` 也继续绕过普通
scope 过滤。

Plugin Tool 可以覆盖内置同名工具。Composition Root 通过
`shouldPreserveBaseTool()` 标记注册顺序晚于 Plugin 的动态 MCP 工具，因此 MCP 同名时仍由 MCP
胜出。该回调保留了产品层优先级，没有把 MCP 类型写进 Plugin Runtime。

### 2. 动态撤销

模型看到工具后、真正执行前，Runtime 再读取一次当前贡献，并核对：

- `pluginId`
- `tool id`
- `tool name`
- `handlerId`

贡献已删除或 handler 已替换时，不调用旧闭包，抛出结构化错误：

```text
code = plugin_tool_revoked
retryable = false
```

这不是 Turn 级冻结快照。每次模型调用仍重新编译整个轻量 Tool Surface；执行前的二次核对专门处理
模型生成期间发生的宿主撤销。

### 3. 保留旧 Plugin Tool 行为

本轮保留：

- `label` 缺省回退工具名。
- `rendersCard` 时只向模型可见 Schema 注入可选 `md_intro`。
- 调用 handler 前剥离 `md_intro`。
- `timeoutMs` 缺省或小于等于 0 时不设超时。
- handler invocation 的 Session、Model、Conversation、Runtime 和 Tool Call Trigger。
- `value.cards` 提升到模型不可见的 `details.cards`。
- `cards` 从模型可见结果中移除。
- 字符串、`text`、`content`、JSON 和 `undefined` 的旧结果格式化顺序。

新实现用旧 `withMdIntroParameter()` 做差分断言，避免注入 Schema 漂移。

### 4. TypeBox Handler Result 边界

新增 Plugin Tool 返回值校验：

```text
{
  value: unknown,
  effects: AgentPluginRuntimeEffect[]
}
```

非法对象不会进入消息详情或 Run Orchestrator。`effects` 继续复用第 64 轮的 Runtime Effect
TypeBox 联合 Schema。

### 5. Tool Effect 提交

`CodingAgentPluginRunOrchestrator` 新增两个受 Turn 约束的能力：

- 构造 Plugin Tool handler 上下文。
- 把校验后的 Tool effects 提交到当前 active Turn。

因此一次 Tool Call 返回后，下一次模型调用会看到：

- 新增、替换、更新或删除后的 Prompt Block。
- `setToolEnabled` 后的工具集合。
- `requestContinuation` 产生的普通 follow-up 消息。

错误 Turn ID 不会把 effect 写入另一个 Turn。

### 6. CLI Composition Root

CLI Greenfield 工厂现在为每个 Session 创建：

```text
CodingAgentPluginRunOrchestrator
CodingAgentPluginToolRuntime
```

二者共享该 Session 的动态 Plugin Source，但不共享状态。Plugin Tool Runtime 使用与 Runtime Tools
相同的动态 capability 解析结果，并把 `agentMode` 作为独立激活轴传入。

`CodingAgentPluginRuntimeSource` 新增可选 `invokeTool`，原有只提供 Prompt 或 Continuation bridge 的
调用方保持兼容。

### 7. 测试运行入口修正

Coding Agent Vitest 原先只映射了 `@vetta/runtime-core` 和 sandbox 子路径。本轮第一次从 Coding
Agent 源码运行时引用 Kernel 的值导出，因此补充 `@vetta/runtime-core/kernel` workspace 源码映射。
测试不再意外读取旧 `dist`。

## 测试

### Agent Core

```text
bunx vitest --run test/tool-execution-context.test.ts
```

结果：`1 passed`。

验证工具上下文包含 User Message 和触发工具调用的 Assistant Message。

### Coding Agent

```text
bunx vitest --run \
  test/runtime-core/greenfield-plugin-tool-runtime.test.ts \
  test/runtime-core/greenfield-plugin-run-orchestrator.test.ts
```

结果：`5 passed`。

覆盖：

- scope、requires、显式激活和 Tool Policy 顺序。
- Plugin、内置工具和受保护 MCP 的同名优先级。
- 两个 Session 的 Tool Surface 不互相污染。
- `md_intro` 旧新差分。
- Conversation、Model、Runtime 和 Trigger 调用合同。
- Card 提升与模型可见结果格式。
- 同 Turn Prompt、Tool 和 Continuation effect。
- 动态删除、非法 Handler Result 和超时。

### Runtime Core

```text
bunx vitest --run \
  test/kernel/model-call-frame.test.ts \
  test/kernel/agent-core-turn-engine.test.ts
```

结果：`10 passed`。

验证新增消息字段没有改变 Frame 解析、工具授权、工具结果和 Agent Loop 适配。

### CLI 端到端

```text
bunx vitest --run \
  test/greenfield-runtime-composition.test.ts \
  test/greenfield-plugin-runtime.test.ts \
  test/greenfield-plugin-tool-runtime.test.ts
```

结果：`13 passed`。

真实文件会话中验证：

- Plugin Tool 出现在首个模型调用。
- `md_intro` 不进入 handler。
- Tool Result 和 Card details 持久化。
- Tool effect 在第二次模型调用生效。
- requested continuation 触发第三次模型调用并持久化 User Message。
- 既有动态 Registry、MCP、Prompt Provider 和 Session 恢复测试不回归。

### 质量门禁

```text
bun run check:quick
bun run check
```

最终结果：全部通过。完整门禁执行了 Biome、根 monorepo 类型检查、CLI 独立类型检查、Desktop、
Admin 和质量 guards。

实施中的第一次完整检查发现 `ToolExecutionContext.messages` 设为必填会破坏既有工具适配器。最终
合同改为可选字段，并由 Agent Loop 在正常执行路径保证提供；这样既满足 Plugin 语义，又保持旧
工具调用 API 兼容。第二次检查发现 Runtime Adapter 需要对可选消息做 optional chaining，修复后
第三次完整检查通过。

## 修改范围

- `packages/agent`
  - 工具执行上下文消息视图及其测试。
- `packages/runtime-core`
  - 通用 Runtime Tool Request 消息字段和 Agent Core Adapter。
- `packages/coding-agent`
  - Plugin Tool Runtime、TypeBox 校验、Run Orchestrator 接口、Composer 接入、导出和测试。
- `packages/cli-app`
  - Session 级生产组合和端到端测试。
- 本实施日志与索引。

## 明确未实施

- 未把 Plugin Tool 注册到共享 `RuntimeToolRegistry`。
- 未改变旧 `AgentSession` 的 Plugin Tool 实现或默认生产入口。
- 未迁移 Plugin 安装、发现、Renderer Slot 或 Desktop 主进程 bridge。
- 未迁移 Todo Continuation 和 Stop Hook。
- 未设计 Plugin Tool 并发执行；当前仍遵循 Agent Loop 的顺序执行语义。
- 未把 Extension Tool 迁入 Greenfield，因此本轮只为未来的“晚注册宿主工具”保留通用优先级回调。

## 下一步

下一阶段应收敛 Coding Agent 的自然停止编排，而不是继续增加新的 Kernel 合同：

```text
User follow-up
  -> Todo Continuation
  -> Plugin requested / provider continuation
  -> Stop Hook
```

建议新增一个产品级 `CodingAgentContinuationOrchestrator`，内部组合 Todo、现有 Plugin Run
Orchestrator 和 Stop Hook Adapter，对 Runtime Core 仍只暴露一个 `ContinuationPolicy`。先用旧会话
差分测试锁定优先级、次数限制、错误隔离和消息持久化，再接入 CLI Greenfield Composition Root。
