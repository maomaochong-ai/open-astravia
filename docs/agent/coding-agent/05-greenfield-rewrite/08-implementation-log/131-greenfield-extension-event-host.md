# 第 131 轮：Greenfield Extension Event Host

## 目标

在不重构 Extension 业务功能的前提下，把可以无损映射的旧事件执行合同接入 Greenfield：

- `input`；
- `tool_call`；
- `tool_result`。

本轮同时补齐事件处理器需要的只读 Session Context 和 8 个动态 Context 动作，并将切换判断从
“是否注册过任意事件”细化为“具体注册事件是否已有 Greenfield 等价实现”。

## 实施前分析

### 1. `context` 本轮不能无损迁移

旧 `context` 处理器接收 `AgentMessage[]`，其中可能包含 Extension 自定义消息。Greenfield 的
`ModelCallContextTransformer` 当前只接收已经标准化的 `Message[]`，自定义消息身份在该检查点前已经
被转换，无法再还原。

如果仅把标准消息传给旧处理器，会静默改变 Extension 观察和改写的对象。因此本轮没有伪造兼容：

- `context` 保持具体的 `unsupportedEvents`；
- 注册 `context` 的 Extension 继续回退 Legacy；
- 后续必须先建立保留自定义消息身份的模型调用上下文合同，才能迁移。

### 2. 事件顺序基线

冻结的旧行为如下：

| 事件 | 既有顺序与结果 |
| --- | --- |
| `input` | 在 Skill/Scene/Prompt 展开前执行；按 Extension 加载顺序串行 transform；`handled` 立即短路；异常上报后继续 |
| `tool_call` | 在真实工具执行前串行执行；`block` 立即阻断；处理器异常阻断工具 |
| `tool_result` | 工具成功或失败后执行；成功结果按顺序链式改写 content/details；处理器异常上报后继续 |

生产工具包装顺序保持为：

```text
Ecosystem PreToolUse
  -> Extension tool_call
  -> Runtime Tool
  -> Extension tool_result
  -> Ecosystem PostToolUse / PostToolUseFailure
```

## 实施

### 1. Runtime Core 只读会话端口

Core Assembly 新增三个不包含产品概念的同步只读视图：

- `RuntimeSessionConversationView`：读取当前 `ConversationDocument`；
- `RuntimeSessionQueueView`：读取待处理输入数量；
- `RuntimeSessionContextUsageView`：读取 tokens、context window 和 percent。

这些端口不暴露 Repository、SessionManager 或写命令。Greenfield Extension 适配器用它们投影旧
`ReadonlySessionManager` 的 13 个读取方法，消息树、分支、Label、Header 和 Session Name 均来自当前
Conversation Document。

`ExtensionRunner` 构造依赖从具体 `SessionManager` 收窄为 `ReadonlySessionManager`；Legacy 调用方
继续直接传入原对象，行为不变。

### 2. Session 级 Event Host

新增 `CodingAgentGreenfieldExtensionEventHost`，在一个 Session 内组合：

- 第 130 轮的 13 个命令式 Action；
- 8 个 Context Action；
- Loader 创建的共享 `ExtensionRuntime`；
- 一个 `ExtensionRunner`；
- UI、shutdown 和错误监听生命周期；
- Composition Root 提供的 Session 事件桥。

Context Action 的来源均为真实端口：

- model、idle、abort；
- pending messages、shutdown；
- context usage、manual compact；
- 当前有效 system prompt。

Host 释放时先解绑事件桥并等待 Action Host 的异步 void 操作收敛，再允许 Session/Composition 关闭。

### 3. 输入事件

Runtime Core 的 Prompt Adapter 增加可选的输入拦截结果：

- `continue`：携带可能变换后的 `PromptRequest`；
- `handled`：Backend 返回 `status: "handled"`，不追加用户消息、不创建 Turn。

Coding Agent Prompt Adapter 在 MCP prompt 边界刷新后、Skill/Scene/附件和 Ecosystem Prompt Hook
处理前运行 `input`。Extension 自己调用 `sendUserMessage` 时通过宿主元数据标记 `source:
"extension"`；普通 Greenfield RPC 输入保持 `source: "rpc"`。

### 4. Tool 事件

最终 Model Call Frame 上新增 Runtime Tool Extension Wrapper：

- `tool_call` 可阻断真实工具；
- 成功后的 `tool_result` 可改写 content/details；
- 工具抛错时仍发送 `isError: true` 的 `tool_result`，随后重抛原错误；
- Wrapper 保留原工具 schema、model order、signal、progress 和 phase reporter。

Extension Wrapper 先包真实 Tool，Ecosystem Hook Wrapper 再包外层，因此没有改变旧生产顺序。

### 5. System Prompt 与动态生命周期

旧 input handler 在首个模型调用前即可同步读取 `ctx.getSystemPrompt()`。Greenfield 因此不能等到第一次
`compose()` 才填缓存。

Composition Root 在 Session Capability 编译完成后，用当前 Snapshot、模型绑定和动态工具表预编译一次
基础系统提示词，但不运行可能有调用级副作用的 Plugin Run Orchestrator。后续每次真实 Model Call
Composer 都更新同一个 Session 缓存。

事件桥按 Session ID 注册；Conversation rollover 后与其他 Session-local Runtime 一起重绑定新 ID，
释放时从 Composition Root 移除。

### 6. 事件级兼容判定

兼容性评估新增 `unsupportedEvents`：

- Greenfield 当前支持 `input`、`tool_call`、`tool_result`；
- Extension 只注册这三类事件时，`event-handler` 缺口可以消除；
- 任一其他事件仍存在时，保留 `event-handler` 缺口并回退 Legacy；
- Extension 自注册 Tool、Command、Shortcut、Renderer 的独立缺口完全不变。

## 测试

新增或扩展的回归覆盖：

- 支持事件与 `context` 等不支持事件的逐事件兼容判定；
- input transform 在 Prompt Resource 展开前执行；
- input handled 不创建 Turn、不写消息；
- Tool Call 在执行前发生、block 不执行工具；
- Tool Result 链式改写成功结果，并在工具错误时收到错误事件；
- 真实 Greenfield IM Session 中 Extension Context 可读取 model、idle、queue、usage、header、entries、
  tree 和首轮 system prompt；
- Provider/Flag-only Extension 与既有 Action Host 行为继续通过。

针对性测试：

- coding-agent：4 个文件、10 项通过；
- CLI Greenfield IM Host：1 个文件、7 项通过；
- runtime-core 全量：31 个文件、152 项通过；
- 根 TypeScript `tsgo --noEmit` 通过。

最终质量门：

- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo/CLI/desktop/admin 类型检查和质量守卫；
- `bun run test:changed` 因当前分支存在大量非本轮变更而触发全仓测试，失败项集中在缺失生成模型目录、
  Windows shell/路径差异和旧 mock 不完整等既有基线；本轮新增及直接相关测试均通过。

## 明确未修改

- 没有迁移 `context`、`before_agent_start`、Turn/Session 生命周期等其他事件；
- 没有迁移 Extension 自注册 Tool、Command、Shortcut 或 Message Renderer；
- 没有删除 Legacy Extension Host；
- 没有改变 Skill、Scene、Prompt Hook、Ecosystem Tool Hook 或真实 Tool 的业务算法；
- 没有把 Extension 类型、Runner 或 SessionManager 下沉到 Runtime Core；
- 没有用 Runtime Snapshot 冻结 Extension、Skill 或 Tool 的动态生命周期。

## 结果

Greenfield Extension 兼容性不再以整个 `event-handler` 粗粒度回退。首批可无损映射的输入与工具事件已
通过 Session 级桥接进入真实运行链路，同时保留动态工具、提示词和会话状态的运行时变化。

不能无损迁移的事件继续以具体名称可观察并保守回退，没有用近似实现换取表面覆盖率。

## 下一步

第 132 轮应先分析 `before_agent_start` 与 Turn 生命周期事件的真实检查点：

1. 冻结 system prompt/message 修改顺序、错误隔离和 continuation 交互；
2. 判断哪些事件可由 Model Call Frame / Turn Observer 无损承载；
3. 为可迁移事件建立独立宿主合同和差分测试；
4. `context` 必须等待自定义消息身份保留合同，不与其他事件捆绑放行；
5. Tool 注册、Command、Shortcut、Renderer 继续作为独立阶段。
