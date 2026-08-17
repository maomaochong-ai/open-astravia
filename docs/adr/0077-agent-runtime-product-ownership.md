# Agent、Runtime 与 Coding 产品职责分层

## 状态

Accepted

## 背景

`@vetta/coding-agent` 最初承担 Coding Agent 产品组合，但在演进中同时吸收了 Session 生命周期、
Runtime Host、平台 Adapter、SDK/RPC Host、历史格式和产品能力。当前 `host`、`composition` 与
`adapters` 已成为包内最大的三个区域，使“产品语义”退化为无法判断所有权时的默认落点。

ADR-0075 已将环境实现归给平台 Runtime，ADR-0076 已证明 Todo 等产品能力可以通过通用 Session
Extension 组合。本决策进一步明确 `agent`、`runtime-core` 与 `coding-agent` 的所有权，不新增包。

## 决策

### `@vetta/agent-core`

拥有一次 Agent 执行所需的最小闭环：模型调用与 Tool Loop、消息和工具结果状态转换、流式事件、
错误、取消、usage 与 stop 传播。它只依赖 AI 协议和自身合同，不依赖 Runtime、产品或平台包。

### `@vetta/runtime-core`

拥有产品无关的多轮运行机制：Session、Turn admission、Queue、Runtime Snapshot、Conversation
Document、生命周期事务、恢复、资源所有权、Port、Session Extension 组合和通用事件路由。

`runtime-core` 不定义 Todo、IM、知识库、Coding Prompt、产品 Profile 或其他产品规则，也不访问
文件系统、进程、数据库、Electron 等具体环境。

### `@vetta/coding-agent`

拥有 Coding Agent 的产品定义，而不是通用 Runtime Host：默认 Profile、Prompt、Mode、产品 Feature、
Todo、Memory/Knowledge/Skill/Plugin/IM 的产品策略、上下文和 Compaction 策略，以及稳定产品 API 的
语义映射。

它可以声明要组合的 Feature 和 Session Extension，但不拥有通用 Session 生命周期、平台 I/O、进程
入口或最终平台 Composition Root。

### 现有 Runtime 与宿主包

`runtime-storage`、`runtime-tools` 和 `runtime-mcp` 继续拥有协议、Schema、错误和纯不变量；
`runtime-node`、`runtime-desktop` 继续拥有对应环境实现与平台组合；应用只拥有自身 UI、进程入口和
传输接线。不为本次职责收敛创建新包。

## 判断顺序

代码所有权按以下顺序判断：

1. 是否是单次模型与工具执行闭环；是则属于 `agent`。
2. 是否是不含产品名词的 Session/Turn 通用机制；是则属于 `runtime-core`。
3. 是否表达 Coding Agent 的默认选择或产品规则；是则属于 `coding-agent`。
4. 是否访问具体环境；是则属于现有平台 Runtime 或应用宿主。

“可跨平台”不是进入 `runtime-core` 的充分条件。Todo 可以跨平台，但它仍是产品能力；Session
Extension 的依赖排序和回滚没有 Todo 语义，因此属于 `runtime-core`。

## 依赖方向

```text
ai <- agent <- runtime-core <- coding-agent <- platform runtime / app
                         ^           |
                         `-----------'
```

`coding-agent` 可以直接使用下层公开合同。下层不得反向依赖产品包；`agent` 不得依赖任何
`runtime-*` 包。平台 Runtime 可以组合 `coding-agent`，但不得把环境类型泄漏到下层合同。

## 迁移策略

1. 建立职责台账、包级说明和机械依赖守卫。
2. 收敛 Agent 执行内核，反转当前 Agent 对 Runtime telemetry 合同的依赖。
3. 将 `coding-agent/host` 与 `composition` 中产品无关的 Session 机制迁入 `runtime-core`。
4. 以 Todo 为首个纵向切片，令产品状态、Tool 和策略完整归属 `coding-agent`，通用生命周期继续使用
   `runtime-core` Session Extension，并移除纯 Todo 逻辑对 `runtime-node` 的依赖。
5. 按相同标准迁移 Memory、Knowledge、Skill、Plugin、IM 和其他产品能力。
6. 将最终平台组装收敛到现有 `runtime-desktop`、CLI 等宿主，最后缩小 `coding-agent` 公开面。

迁移保持现有 Tool Schema、消息、事件、取消、错误、会话数据和公开产品行为。兼容入口只能作为有
期限的薄转发，不能形成第二条执行路径。

## 被拒绝方案

### 把所有跨平台能力放进 `runtime-core`

这会使 Runtime Kernel 认识 Todo、IM 和 Coding 产品规则，只是把杂物间从一个包搬到另一个包。

### 把所有与 Agent 有关的代码放进 `agent`

Session 生命周期、产品规则和平台 I/O 都与 Agent 有关，但不属于单次执行闭环。这样会使最底层内核
重新依赖上层变化。

### 继续用 `coding-agent` 作为默认组合层

“组合层”无法约束所有权，任何 Host 或 Adapter 都可以因此进入该包。产品定义和最终平台组合必须
分开。

## 后果

- `coding-agent` 仍是必要的产品包，但它的规模由产品能力决定，不再承载通用运行时基础设施。
- `runtime-core` 可以被不同产品复用，且不强迫平台继承 Coding Agent 功能。
- `agent` 成为可独立嵌入的最小执行内核。
- 迁移会涉及公共类型来源和 Composition 接线，需要按切片保留兼容并运行跨包合同测试。
- 本决策细化 ADR-0075 中“当前 coding-agent 是 Node 产品组合”的阶段性描述，并取代旧重写合同中
  “coding-agent 拥有稳定 Session 合同”的所有权定义。
