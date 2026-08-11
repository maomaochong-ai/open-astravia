# 第 134 轮：Runtime 消息身份与 Extension 消息事件

## 目标

在不改变旧 Extension 功能语义的前提下，把 `message_start`、`message_update`、
`message_end` 和 `agent_end` 从 Legacy 回退迁移到 Greenfield；同时明确 `context` 事件
仍不能由现有标准消息历史无损表达，继续保留 Legacy 回退。

## Legacy 基线

旧执行链的关键事实如下：

- `agent_start` 后先发 `turn_start`；显式 Run 的新增输入随后逐条发
  `message_start` / `message_end`；
- assistant 流发 `message_start`、零到多次 `message_update`、`message_end`；工具结果和
  steering/follow-up 消息也发 start/end；
- `agent_end.messages` 只包含本次 Agent Run 新增的消息，不包含历史消息；
- Extension Event Router 在持久化和普通监听器之前执行 handler；
- `context` handler 接收完整历史 `AgentMessage[]`，按 Extension 注册顺序链式替换，单个
  handler 失败不会中断后续 handler；变换只作用于当次模型调用，不写回会话历史。

Greenfield 的 Conversation 投影目前只保存标准 `Message[]`。历史中的 custom、branch
summary、compaction summary 等身份会在模型投影中被转换或过滤。因此，直接用标准历史
伪造 `context` 会改变功能，不能宣称兼容。

## 实施内容

### 1. 产品无关的 Runtime Message Envelope

Runtime Core 新增 `RuntimeMessageEnvelope`：

- `message` 分支承载标准模型消息；
- `context` 分支承载通用 `SessionContextRecord` 和已确定的时间戳。

该合同保留执行观察所需身份，但不进入模型消息、Conversation Document 或公开
`SessionEvent`，也不引用 Coding Agent 的 `CustomMessage`。

执行观察合同新增：

- `agent.end`；
- `message.start`；
- `message.update`；
- `message.end`。

### 2. Pipeline 组装显式 Run 的新增消息身份

Turn Pipeline 在持久化输入时同步建立只读身份视图，顺序为：

```text
input.context
  -> input.message
  -> input.trailingContext
  -> AgentRunPreparer.context
```

模型不可见的 Context Record 仍进入身份视图，因为旧 Extension 可以观察这类 Custom
Message；它们不会因此进入模型上下文。无输入的 `continue()` 传递空身份视图，不伪造
用户消息。

### 3. Agent Core 执行观察映射

Agent Core Turn Engine 保留底层事件顺序，并在首个 `turn_start` 后为显式 Run 输入补发
start/end：

```text
agent.start
  -> turn.start
  -> initial message start/end ...
  -> generated message lifecycle ...
  -> turn.end ...
  -> agent.end
```

生成的 assistant、tool result、steering 和 follow-up 消息直接映射底层消息事件；活动
Turn 排队的通用 Context 通过 request-scoped 身份表关联 Agent Message 与 Context
Envelope，保留可见与不可见身份，仅在 LLM 边界按 `modelVisible` 转为标准 User Message
或过滤，因此观察功能与模型输入互不干扰；
`message.update` 原样保留 `AssistantMessageEvent`。`agent.end` 合并显式 Run 输入身份和
Agent Core 本轮新增消息，保持旧 `newMessages` 语义。执行观察仍在 canonical message
持久化之前发布，Extension handler 的观察顺序不变。

### 4. Coding Agent 窄适配

Greenfield Extension Observation Adapter 只在产品边界把通用 Context Envelope 恢复为：

- `role: "custom"`；
- `customType = record.type`；
- 原 `content`、`display`、`metadata/details` 和时间戳。

标准消息保持对象身份和 payload。兼容性门禁现已允许 `agent_end` 与全部 `message_*`
事件进入 Greenfield；`context` 仍是唯一尚未支持的消息相关事件。

## Schema 判断

本轮没有引入 TypeBox 或 Zod。新增对象只在同进程、静态类型控制的 Kernel/Adapter
边界流动，不是外部 JSON、配置文件或持久化反序列化输入。为内部判别联合增加运行时
Schema 只会形成重复真相源，不能解决历史 `AgentMessage` 身份缺失问题。

## 测试

新增或更新测试覆盖：

- 标准 assistant、tool result 的完整消息生命周期顺序；
- 显式 Run 的 Context/User 输入 start/end 顺序；
- `agent.end` 只包含当前 Run 新增身份，并保留 Custom Context metadata；
- Pipeline 对可见、不可见、trailing 和 Run Preparation Context 的有序组装；
- 活动 Turn 排队的可见/不可见 Context 均保留事件身份，但只有可见项进入模型；
- `continue()` 不生成初始消息身份；
- Coding Agent Adapter 恢复 Custom Message，并透传 `AssistantMessageEvent`；
- 兼容门禁允许 `agent_end` / `message_*`，但继续拒绝 `context`。

验证结果：

- `runtime-core`：2 个针对性测试文件、29 个测试通过；
- `coding-agent`：2 个针对性测试文件、8 个测试通过；
- 根 `bun run check` 通过，包括 Biome、全仓类型检查和 quality guards。

## 明确未修改

- 没有修改标准模型消息、Tool Loop、持久化或公开 Session Event 的功能。
- 没有把 Coding Agent Custom Message 类型下沉到 Runtime Core。
- 没有把模型不可见 Context 注入模型。
- 没有把历史标准消息错误地放进 `agent_end.messages`。
- 没有迁移 `context`，也没有为了减少回退而丢失历史消息身份。

## 结果与下一步

Greenfield 已能无损承载当前 Agent Run 的消息观察身份，Extension 的
`agent_end` / `message_*` 不再需要 Legacy 执行。下一阶段应建立独立的、可重建完整
AgentMessage 历史的产品投影，再把逐模型调用的 `context` 变换适配到现有 transient
`ModelCallContextTransformer`；在该投影完成前，`context` 必须继续 fail closed。
