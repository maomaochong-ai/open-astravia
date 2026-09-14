# 范围、现状与基本边界

## 1. 重写决策

这里的“并行构建”只是一种交付隔离手段，不代表长期维护两套架构。最终结果仍然是：

- 旧 `coding-agent` 内部代码全部删除。
- 旧目录结构和内部类不保留。
- 新公开 API 只暴露稳定合同，不暴露 Manager、Registry 等实现对象。
- `coding-agent` 退回产品组合根，不再拥有所有能力的具体实现。
- `@vetta/ai` 和 `@vetta/agent-core` 作为已经独立的下层能力继续使用，除非单独审计发现其合同无法满足新内核。

全面重写的重点不是重新排列目录，而是先修正包依赖方向。否则即使代码全部重写，旧架构仍会通过下游调用方式重新长回来。

## 2. 假设与范围

### 2.1 假设

本方案基于以下假设：

1. 可以接受一次有计划的内部 breaking change，并在同一个变更周期内迁移 monorepo 中的调用方。
2. 会话历史、认证配置、模型配置等用户数据不能因为代码重写而丢失。
3. CLI、Desktop、RPC 和 IM 的产品行为需要继续存在，但不要求保留其当前内部调用方式。
4. `@vetta/ai` 继续负责模型供应商协议和统一消息格式。
5. `@vetta/agent-core` 继续负责单轮模型调用、工具循环和基础事件，重写前先通过合同测试验证，而不是默认重写它。
6. 旧测试中的业务行为可以作为行为清单，但测试对旧内部类和目录的依赖不构成兼容要求。

如果第 1 条不成立，就不能实施真正的全面重写，只能采用兼容层驱动的渐进重构。

### 2.2 明确保留

- 用户可观察的核心行为。
- 需要继续支持的 CLI、SDK、RPC 和 IM 协议。
- 会话、认证、设置等持久化数据，或对应的显式迁移器。
- 模型和工具消息协议。
- 必要的错误语义、取消语义和事件顺序。
- 仍然有效的测试场景与测试数据。

### 2.3 明确舍弃

- 当前 `src/core` 目录结构。
- `AgentSession`、各种 Manager 和 Registry 的现有实现。
- 通过 `coding-agent` 根入口导出的数百个内部符号。
- 下游包对 `coding-agent` 具体类、属性和内部目录的直接依赖。
- 扩展、MCP、Skill、知识库各自修改 Agent 状态的独立通道。
- 可变共享 `metadata`、运行期动态追加工具、隐式全局注册表。
- 仅为兼容旧内部设计而存在的抽象。

### 2.4 不在本次重写范围内

- 重新实现所有模型供应商。
- 重写 Desktop 的领域业务。
- 把 Plugin、Theme、Action 合并成 Agent 扩展。
- 为未来可能出现的能力提前设计通用 DSL。
- 同时改变所有用户可见产品行为。

## 3. 当前结构为什么不能直接原地翻新

### 3.1 规模只是表象

当前 `packages/coding-agent/src` 有约 197 个 TypeScript 文件、4.1 万行代码，其中 `core` 目录约 170 个文件。多个文件同时超过 700 至 1,700 行。

大文件会增加维护成本，但它不是根因。根因是一个包同时承担了：

- 产品入口。
- Agent 会话。
- 模型和认证管理。
- 工具实现。
- MCP。
- Skill。
- Extension。
- Plugin。
- 知识库。
- Compaction。
- 子 Agent。
- SDK、RPC、CLI 和 UI 适配。

这些职责并不处于同一抽象层。

### 3.2 依赖方向已经倒置

当前存在以下依赖：

```text
coding-agent -> runtime-core
runtime-core -> coding-agent

runtime-storage -> coding-agent
runtime-tools   -> coding-agent
runtime-mcp     -> coding-agent
```

这会产生两个问题：

1. `runtime-core` 无法成为中立运行时合同，因为它反向依赖 `coding-agent` 的具体实现。
2. `runtime-storage`、`runtime-tools`、`runtime-mcp` 名义上拥有独立职责，实际上只是在重新导出 `coding-agent` 内部代码。

如果只重写 `coding-agent`，这些包仍会要求新代码继续提供旧 Manager、旧工具工厂和旧 MCP Manager，最终得到的只是换过文件名的旧架构。

### 3.3 公开 API 把内部结构固化成了合同

`packages/coding-agent/src/index.ts` 约 444 行，导出了大量具体类、工具、存储、知识库和扩展类型。Desktop 与 runtime 包也直接读取：

- `AgentSession` 的具体属性。
- `ModelRegistry`。
- `SessionManager`。
- `AuthStorage`。
- `DefaultResourceLoader`。
- MCP Manager。
- 内置工具工厂。
- 知识库命名空间。

这些不是一个 Coding Agent 产品应向宿主暴露的最小合同，而是内部实现泄漏。

### 3.4 “能力”概念存在命名冲突

仓库已经有 `@vetta-org/capability-sdk` 和 `@vetta/capability-runtime`。它们定义的是：

> 宿主向 Plugin、Theme、Action 等调用方提供的、带授权的基础能力和领域能力。

而 Agent 重写中需要的“能力编排”是：

> 向某次 Agent 运行贡献 instructions、tools、context provider、policy 和 lifecycle 的运行时模块。

两者不能使用同一个抽象：

- Host Capability 是可被调用的服务。
- Agent Feature 是构造 Agent 运行快照的模块。
- Tool 是模型可调用的函数。
- Tool 内部可以调用经过授权的 Host Capability。

本方案统一使用 `AgentFeature` 表示 Agent 运行时模块，避免把它塞入现有 `CapabilityRegistry`。

## 4. 从模型原语重新定义边界

从 AI 模型本身看，Coding Agent 的最小闭环只有：

```text
输入消息
-> 构造上下文
-> 调用模型
-> 模型输出文本或 Tool Call
-> 执行 Tool
-> 把 Tool Result 返回模型
-> 直到停止
```

因此内核只需要负责以下不变量：

1. 一次会话最多有一个活动 Turn。
2. 一个 Turn 使用一个不可变的运行快照。
3. 所有工具调用都通过同一个 Tool Runtime。
4. 取消信号可以传播到模型、工具和上下文加载。
5. 消息和事件按确定顺序写入会话存储。
6. Turn 结束后才允许原子切换到新的运行快照。
7. 资源在 Session 关闭时按相反顺序释放。

其他功能都应由内核之外的模块构建：

| 功能 | 本质 | 在新架构中的位置 |
| --- | --- | --- |
| IM | 输入输出传输适配 | `ImAdapter`，调用稳定的 Session API |
| CLI / RPC / Desktop | 宿主适配 | Adapter，不进入 Turn Kernel |
| Tool | 模型可调用函数 | 统一 `ToolRuntime` |
| MCP | 外部 Tool Provider | `McpFeature`，贡献 Tool 定义 |
| Skill | 声明式指令、资源和工具策略 | `SkillFeature`，编译为运行贡献 |
| 知识库 | 检索上下文和可选管理工具 | `KnowledgeFeature` |
| Memory | 上下文提供者和 Turn 观察者 | `MemoryFeature` |
| Compaction | 上下文预算策略 | `ContextStrategy` |
| 子 Agent | 通过端口创建隔离 Session 的工具 | `SubagentFeature` |
| 权限 | 工具执行前的决策 | `ToolPolicy` / Host Capability Grant |
| Plugin / Theme / Action | 产品扩展系统 | 保持在自己的系统适配层 |

因此，“Coding Agent 是一个内核加能力编排”的理解是正确的，但需要补充：

> 编排的结果不是持续修改一个全局 Agent 对象，而是编译出每个 Turn 使用的不可变 Runtime Snapshot。
