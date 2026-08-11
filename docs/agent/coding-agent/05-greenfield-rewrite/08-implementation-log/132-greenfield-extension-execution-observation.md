# 第 132 轮：Greenfield Extension 执行观察事件

## 目标

在不改变旧 Extension 功能语义的前提下，把可以无损表达的 Agent、Turn 和 Tool
执行事件接入 Greenfield；同时建立独立于产品 Extension 和公开 `SessionEvent` 的
Runtime 执行观察合同，避免再次把内核事件、宿主投影和插件协议混成一个类型。

## 范围判断

旧 Extension 事件不是同一种能力：

- `agent_start`、`turn_start`、`turn_end` 和 `tool_execution_*` 是执行观察；
- `session_start`、`session_shutdown` 是宿主 Session 生命周期；
- `input`、`tool_call`、`tool_result` 会影响执行，已由第 131 轮的专用拦截点承载；
- `before_agent_start` 可以改写系统提示词，属于 Agent Run Preparation，不是观察；
- `agent_end`、`message_start`、`message_update`、`message_end` 和 `context`
  依赖完整旧 `AgentMessage` 身份，当前 Greenfield 的标准 `Message` 不能无损表示。

因此本轮只迁移可证明等价的事件。不能等价的事件继续进入
`unsupportedEvents` 并回退 Legacy，不通过伪造消息扩大 Greenfield 覆盖率。

## 实施内容

### 1. Runtime Core 执行观察合同

新增 `RuntimeExecutionObservationEvent`，只包含产品无关的执行事实：

- `agent.start`；
- `turn.start` / `turn.end`；
- `tool.execution.start` / `update` / `phase` / `end`。

Agent Core Adapter 从已有 `AgentEvent` 映射该合同，Turn Pipeline 在继续处理公开
观察事件前发布 `execution.observation` Kernel Envelope。该事件不进入
Conversation Document，不参与恢复，也不改变 Turn 状态。

Greenfield Session Assembly 新增 `executionObservationStream`。它按发布顺序
`await` 每个异步观察者；单个观察者抛错会被隔离，后续观察者和 Turn 均继续执行。
这样 Extension 的异步 handler 时序与旧 Runner 一致，同时插件故障不会破坏内核。

事件顺序为：

```text
Agent Core Event
  -> Runtime execution observation
  -> ordered async Extension observer
  -> compact public observation / persistence
```

公开 `SessionEvent` 继续服务 UI/RPC 的稳定、可序列化投影，不承担完整 Tool
执行 payload。两条观察链路职责不同，不相互冒充。

### 2. Coding Agent Extension 适配

新增 Greenfield Extension Observation Adapter，把 Runtime 事件映射回旧 Extension
事件，并维护会话内的 `turnIndex`：

- `agent_start` 时归零；
- 每个 `turn_start` / `turn_end` 使用当前索引；
- `turn_end` 完成后递增；
- Tool 事件保留 `toolCallId`、参数、partial result、phase、timing、result 和错误。

Session Event Host 订阅该异步观察流，并负责宿主生命周期：

- `initialize()` 完成绑定后只发一次 `session_start`；
- `shutdown()` / `dispose()` 只发一次 `session_shutdown`；
- shutdown handler 执行时 Action Host 尚可用，随后才释放绑定。

### 3. 兼容性与生产组合

Greenfield 兼容事件集合扩展为：

- `input`；
- `session_start`、`session_shutdown`；
- `agent_start`；
- `turn_start`、`turn_end`；
- `tool_call`、`tool_result`；
- `tool_execution_start`、`tool_execution_update`、
  `tool_execution_phase`、`tool_execution_end`。

以下事件仍明确要求 Legacy：

- `agent_end`；
- `message_start`、`message_update`、`message_end`；
- `context`；
- `before_agent_start`。

CLI Greenfield Runtime Composition 在初始化能力时等待 Event Host 的异步
`initialize()`，确保 `session_start` 完成后才接受后续会话操作。

## 明确未修改

- 没有改变旧 Extension 事件 payload、handler 顺序或错误隔离规则。
- 没有把 Extension 类型下沉到 Runtime Core。
- 没有把瞬时执行观察写入会话存储。
- 没有用不完整的标准消息伪造旧 `AgentMessage`。
- 没有实现 `before_agent_start` 的系统提示词改写。
- 没有引入 TypeBox/Zod：本轮是同进程、编译期受控的类型合同，不是外部输入或
  持久化反序列化边界；运行时 Schema 校验在这里没有额外收益。

## 测试

新增或更新测试覆盖：

- Agent Core 简单 Turn 和 Tool Loop 的完整执行观察顺序；
- Greenfield Session 异步观察者的有序等待和异常隔离；
- Runtime 到 Extension 的 turnIndex、时间戳和完整 Tool payload 映射；
- Extension 兼容集合与身份/可变更事件的 Legacy 回退；
- CLI 真实能力初始化和 shutdown 恰好一次的生命周期。

针对性验证结果：

- `runtime-core`：36 个相关测试通过；
- `coding-agent`：10 个相关测试通过；
- `cli-app`：8 个相关测试通过；
- 根 TypeScript `tsgo --noEmit` 通过。

完整验证结果：

- `runtime-core` 全包：31 个测试文件、153 个测试全部通过；
- `cli-app` 全包：22 个测试文件中 21 个通过，87 个测试中 86 个通过；唯一失败是
  既有 System Prompt 用例少预期了一次会话创建期的空上下文解析，与本轮执行观察
  文件及事件链路无关；
- `coding-agent` 全包仍有既有 Windows 路径、旧 `pi` 文案、模型夹具和 mock
  基线失败；本轮涉及的 Extension 兼容与观察适配测试全部通过；
- 根 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和
  quality guards。

## 结果

Greenfield 现在具备独立的执行观察层，Extension 不再需要借用面向 UI/RPC 的
`SessionEvent` 获取完整 Tool 生命周期。可无损表达的旧事件已经切换，依赖旧消息
身份或会改变执行的事件继续受兼容性门禁保护，架构迁移没有变成功能改写。

## 下一步

第 133 轮应建立独立的 Agent Run Preparation 合同，先处理
`before_agent_start` 的系统提示词改写、顺序、取消/异常语义和每次 Agent Run
边界；它不应加入执行观察流。完成后再评估消息身份模型，决定
`message_*`、`agent_end` 与 `context` 是否可以无损迁移。
