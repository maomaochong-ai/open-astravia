# 第 133 轮：Agent Run Preparation 与 before_agent_start

## 目标

把旧 Extension `before_agent_start` 无损迁移到 Greenfield，同时建立独立于执行观察、
Prompt Adapter 和模型调用 Composer 的 Agent Run Preparation 合同。该合同只在显式
用户输入启动一次 Agent Run 时执行，不把 Run 级行为误做成每次模型调用的 Middleware。

## 架构判断

`before_agent_start` 同时具备三种语义：

- 读取最终展开后的用户文本和图片；
- 读取并按 handler 顺序替换本次 Run 的系统提示词；
- 在当前用户消息之后追加模型可见的自定义消息。

因此它不属于：

- 输入拦截：此时最终系统提示词尚未编译；
- 执行观察：handler 会改变执行输入；
- Model Call Composer：同一 Agent Run 的工具循环会多次调用 Composer，不能重复执行
  `before_agent_start`；
- Session 生命周期：无输入的 `continue()` 不应触发该事件。

本轮把它放在 Turn Pipeline 的 `context_preparation` 内部、Context Strategy 与压缩
finalization 之后、Turn Engine 之前。Pipeline 固定控制一次性时序，产品实现通过
`AgentRunPreparer` 插入。

## 实施内容

### 1. Runtime Core Run Preparation 合同

新增：

- `AgentRunPreparationContext`：提供 Session/Turn 身份、显式输入、已准备消息、
  Turn 模型绑定和惰性的 `resolveSystemPrompt()`；
- `AgentRunPreparationResult`：返回需要持久化的通用 Context Record，以及本次 Run
  固定使用的 `instructionOverride`；
- `AgentRunPreparer`：Profile 独占的一次性准备器。

该边界不引用 Extension、Plugin、Skill 或 Coding Agent 类型。Feature Compiler 只把
Profile 的准备器绑定进不可变 Runtime Snapshot，不把它做成可串联的万能 Middleware。

### 2. 惰性 Prompt 编译与首次 Frame 复用

无 handler 时，Coding Agent 准备器直接返回，不调用 `resolveSystemPrompt()`，因此不
增加额外 Model Call Frame 编译。

有 handler 时，Pipeline 首次请求基础 Prompt 才编译 Frame，并在本次 Run 内缓存：

```text
prepared messages
  -> lazy compile first Model Call Frame
  -> before_agent_start handlers
  -> persist returned context
  -> Agent Core reuses first Frame
  -> later tool-loop calls dynamically compile new Frames
```

这样基础 Prompt 不会因准备事件被编译两次；后续模型调用仍可观察动态 Tool、MCP、
Plugin 和 Skill 变化。Run 级 Prompt 覆盖在整个工具循环中保持固定，符合旧
`setSystemPrompt()` 的行为。

### 3. Coding Agent Extension 适配

`CodingAgentGreenfieldExtensionEventBridge` 实现 `AgentRunPreparer`：

- 仅在已绑定 Runner 且存在 `before_agent_start` handler 时工作；
- 从最终 `SessionInput.message` 提取文本和图片；
- 继续复用 `ExtensionRunner.emitBeforeAgentStart()`，保留扩展顺序、Prompt 链式替换和
  handler 异常隔离；
- 把返回的 Custom Message 映射为通用、模型可见、可持久化的 Context Record；
- 只有 truthy `systemPrompt` 才形成 Run 级覆盖，保持 Legacy 的空字符串处理语义。

生产 Composition Root 将同一个 Session-local Extension Event Bridge 同时用于输入、
工具和 Run Preparation，不创建第二份 Runner 或状态。

### 4. 兼容性门禁

`before_agent_start` 已加入 Greenfield 支持事件集合。仍要求 Legacy 的事件为：

- `agent_end`；
- `message_start`、`message_update`、`message_end`；
- `context`。

这些事件依赖完整旧 `AgentMessage` 身份或逐调用消息改写，不能由本轮合同伪造。

## 明确未修改

- 没有改变 Extension handler 注册、执行顺序、错误隔离或返回类型。
- 没有把 Extension Custom Message 类型下沉到 Runtime Core。
- 没有把 Run Preparation 变成可任意排序的 Pipeline 或 Middleware。
- 没有冻结整轮动态工具；首次 Frame 之后仍按每次模型调用重新组合工具。
- 没有让无输入 `continue()` 触发 `before_agent_start`。
- 没有引入 TypeBox/Zod：这是同进程、编译期受控的内部合同，不是外部输入或持久化
  反序列化边界；返回消息仍通过既有 Conversation 投影持久化。

## 测试

新增或更新测试覆盖：

- 显式 Agent Run 恰好准备一次，无输入 continuation 不重复准备；
- `resolveSystemPrompt()` 多次读取只编译一次首次 Frame；
- 准备器不读取 Prompt 时零额外 Frame 编译；
- 返回 Context 的持久化顺序、模型可见性和 Run Prompt 覆盖；
- Agent Core 首次复用准备 Frame，工具循环后续动态重编译但 Prompt 保持固定；
- 真实 ExtensionRunner 的多 handler Prompt 链、文本/图片输入和 Custom Message 映射；
- 无 `before_agent_start` handler 时惰性 resolver 不执行；
- Extension 兼容门禁移除该事件的 Legacy 回退。

针对性验证结果：

- `runtime-core`：2 个测试文件、27 个测试通过；
- `coding-agent`：2 个测试文件、7 个测试通过。
- 根 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和
  quality guards。

## 结果

Greenfield 已获得独立的 Agent Run Preparation 层。`before_agent_start` 现在按旧语义
每个显式 Run 只执行一次，并且同时保留动态能力的模型调用级更新；核心 Pipeline、
产品 Extension 和 Agent Core Tool Loop 的边界不再混用。

## 下一步

第 134 轮应先建立旧 `AgentMessage` 与标准 Runtime Message 的身份差分基线，再决定：

1. 是否扩展 Runtime Message Envelope，以无损承载 `message_*` 和 `agent_end`；
2. `context` 的逐模型调用变换应由现有 `ModelCallContextTransformer` 适配，还是需要
   独立、带消息身份的产品合同；
3. 无法无损迁移的事件继续保持 Legacy 回退，不以覆盖率为目标修改功能。
