# 第 297 轮：Runtime Subagents 生产内核收敛

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

前序阶段已经把 Subagent 工具实现放入 `runtime-tools`，把 Session 创建、恢复和持久化留在 Coding Agent 产品组合层，但 `runtime-subagents` 内部的单个协调器仍同时持有记录索引、FIFO 队列、并发槽位、等待者、通知计时器和交付去重；模型可见通知文本还直接写死 `followup_task`。

本轮把 `runtime-subagents` 收敛为与产品和工具协议无关的子代理调度内核。它继续保留状态机、并发、生命周期和恰好一次交付语义，不接管模型、Tool、MCP、Skill、Conversation 或产品 Profile。

## 实施内容

### 状态所有权

- 新增 `SubagentStore`，独占子代理记录、ID/任务名索引和目标解析；
- 新增 `SubagentScheduler`，独占并发槽位和 FIFO 队列；
- 新增 `SubagentDelivery`，独占 generation 交付声明、等待者、通知计时器和批次；
- `SubagentCoordinator` 保留公开命令和异步 Child 生命周期编排，不再直接维护上述状态集合；
- `SubagentChildFactory`、Handle、Lifecycle、时钟和 ID 生成器继续作为可替换端口，不绑定具体 Session 实现。

### 工具协议边界

- `runtime-subagents` 的通知回调只交付终态 `SubagentSnapshot[]`；
- 原有 `<subagent_notification>` 文本和 `followup_task` 提示迁入 `runtime-tools`；
- Coding Agent 组合层调用 Runtime Tools 投影并继续通过 `deliverAsyncContext` 注入父 Session；
- 通知格式、顺序、截断、自动通知与 `wait_agent` 互斥声明行为保持不变。

### 合同与测试解析

- `spawnMany` 和 `wait` 端口改用只读命名合同；
- Child Event 收紧为协调器实际消费的 `agent_start | agent_end`；
- 删除仓库内零生产消费者的 `typeDocs/describeForTools`；
- Coding Agent 与 Runtime Tools 的 Vitest 增加 `runtime-subagents` 源码映射，避免跨包测试继续加载陈旧 `dist`。

### 防回退门禁

新增 `runtime-subagents-boundary` 门禁并接入 `check:guards` 与 `test:quality`：

- `workspace dependencies=0`：调度内核不得声明任何 `@vetta/*` workspace 依赖；
- `tool protocol tokens=0`：生产源码不得包含具体 Subagent 工具名、通知投影或工具描述接口；
- 既有 Runtime 到 Coding Agent 反向依赖继续保持 `0`。

## 旧实现依赖变化

- `runtime-subagents` 内模型可见通知投影：`1 -> 0`；
- `runtime-subagents` 内具体工具名引用：`1 -> 0`；
- 无生产消费者的工具描述接口：`2 -> 0`；
- `runtime-subagents` workspace 生产依赖：保持 `0`；
- Runtime 到 Coding Agent 反向依赖：保持 `0`；
- Coding Agent 的 Session 创建、恢复与 Conversation 持久化所有权：保持在产品组合层；
- 用户可见 Subagent 工具和通知协议变化：`0`。

## 行为兼容性验证

- `runtime-subagents`：22 项测试通过，新增原始终态交付、批量顺序、Stop Hook continuation 上限和关闭唤醒等待者场景；
- `runtime-tools` Subagent 定向测试：2 个文件、6 项通过，通知文本逐行等值；
- Coding Agent Subagent Session/持久化定向测试：2 个文件、9 项通过；
- 新边界门禁单元测试：2 项通过，实际门禁报告 workspace 依赖和工具协议残留均为 `0`；
- 全套质量门禁测试：146 项中 145 项通过；唯一失败来自本轮未修改的 Desktop `greenfield-runtime` 历史兼容文件已移出 allowlist；
- `runtime-subagents` 与 `runtime-tools` 独立源码类型检查通过；
- 全量 `check:quick` 已执行，但执行时被本轮范围外、仍在并行修改的 Coding Agent 测试源码解析错误阻断；本轮文件没有 Biome 诊断；
- 根级 `bun run check` 已执行，Root、CLI、Desktop、Admin 类型检查和全部质量守卫通过；Lint 被本轮未修改的 `package-manager.test.ts` 换行格式及 `dirty-repo-guard.ts` 未使用参数诊断阻断。

## 尚未完成的替换

本轮识别的 Subagent 工具协议泄漏和协调器多状态所有权已经替换，没有保留兼容分支。`SubagentCoordinator` 仍负责异步 Child 生命周期编排，这是其核心职责，不继续为减少行数拆成共享可变状态的细粒度对象。

全仓检查当前未形成绿色基线，原因是工作区中与本阶段无关的并行改动存在换行格式和未使用参数错误；这些文件需要由对应改动所有者修复后重新执行根级检查。
