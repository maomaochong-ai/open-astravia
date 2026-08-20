# Vetta Subagent

本目录最初记录了 2026-07-17 时的首版落地方案。当前实现已经越过“只注册 Explorer”的 MVP：调度内核、持久化、恢复、Workflow、Desktop 面板都已存在；V2 在这些基础上把子代理收敛为可配置、默认谨慎启用的通用能力。

## 当前结论

Vetta 的子代理采用以下边界：

1. `@vetta/runtime-subagents` 只拥有产品无关的状态机、并发池、FIFO、恢复、wait 和 generation 精确一次交付。
2. `@vetta/coding-agent` 通过 `coding-agent.subagents` Session Extension 拥有定义、能力/上下文/技能/工作区策略、结构化委派合同、父子报告、持久化和控制工具。
3. 子代理是独立 Runtime Session 和独立 JSONL transcript，默认单层；child 不再获得创建 child 的工具。
4. Desktop 只消费稳定快照：状态、Todo、usage/cost、objective、分类错误和 transcript，不拥有调度规则。
5. 子代理是高启动与 token 成本能力。只有一个极复杂请求包含多个彼此无关、互不重叠且各自足够复杂的工作流时，才应批量派生；简单、模糊或顺序任务由 root 直接完成。

## 内置定义

| 定义 | 默认能力 | 上下文 | Todo | 工作区 |
| --- | --- | --- | --- | --- |
| `general` | 继承父工具、MCP 和 Skill | 完整快照 | 开启 | 共享 |
| `explorer` | 显式只读本地工具；MCP fail-closed | fresh | 关闭 | 共享 |
| `workflow` | 继承父工具、MCP 和 Skill | 完整快照 | 开启 | 优先隔离、旧宿主兼容回退 |

内置定义不是 coordinator 分支。Composition Root 可通过内部 `RuntimeCompositionOptions` 注入 `subagentTypeRegistry` 注册其它定义，并用策略组合工具激活、MCP、Skill、上下文、Todo 和工作区；这两个扩展点没有进入稳定公共 SDK。`subagentWorkspacePort` 由宿主提供租约；严格隔离定义可以在端口缺失时 fail-closed。

## 委派合同

新调用应使用结构化 `task`，而不是一句短 `message`。必填字段为：

- `history`：相关历史与已做决策；
- `current_state`：已核实的现状、已有改动和故障；
- `objective`：一个可观察结果；
- `scope`：精确所有权边界；
- `constraints`：规则和不变量；
- `relevant_context`：文件、符号、ADR、外部事实等；
- `deliverables`：必须返回的产物；
- `validation`：完成前必须实际运行的功能测试或检查。

旧 `message` 暂时保留为兼容输入。系统提示和 Tool description 明确要求新模型调用使用结构化合同，并明确“代码写完”不等于完成。

## 控制与通信

Root 保持七个控制 Tool：`spawn_agent`、`dispatch_workflows`、`wait_agent`、`list_agents`、`interrupt_agent`、`send_message`、`followup_task`。

Child 额外得到 `report_to_parent`，可发送 `progress`、`blocked` 或 `validation` 报告，包含产物和验证结果。Workflow 批次采用屏障交付：单个完成不反复唤醒 root，整批进入终态后一次通知；可操作的中间信息仍可通过结构化报告提前送达。

## 生命周期与观察

- Session Extension 贡献 Agent Feature 和 Document Participant，并唯一负责释放 Subagent Runtime。
- `subagent_state_v1` 继续兼容读取；运行中或排队任务在恢复时按既有规则归一化，不误报完成。
- Todo 通过 child Session Extension observation 实时同步，不再只读取创建时快照。
- `subagents_update` 携带可选 usage 以兼容旧事件；直接 Runtime 快照中的 usage 仍为必填。
- Desktop 对原始错误先分类、裁剪，再使用 `destructive` 主题语义呈现。

## 文档导航

1. [01-current-state-and-decisions.md](01-current-state-and-decisions.md)：首版实现前的历史基线。
2. [02-target-architecture.md](02-target-architecture.md)：首版目标架构（历史）。
3. [03-implementation-roadmap.md](03-implementation-roadmap.md)：首版路线图（历史）。
4. [04-testing-and-acceptance.md](04-testing-and-acceptance.md)：测试矩阵，已更新为当前命令。
5. [05-v2-implementation.md](05-v2-implementation.md)：V2 合同、目录、兼容性与剩余边界。

实现过程和逐项验收证据记录在仓库内的 `.ai/subagent-v2/`，它是开发档案，不是公共 API 文档。
