# 第 299 轮：Runtime Subagents 职责所有权与 Coordinator 收敛

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

第 297 轮已经将记录、调度和交付集合从 Coordinator 中分离，但单个协调器仍直接修改 Snapshot、操作 Child Handle、执行生命周期、处理恢复和 wait。该结构无法为并发终态建立单一所有者，也使 Coordinator 继续承担过多职责。

本轮一次完成全部职责迁移，不保留等待下一阶段继续拆分的中间 Coordinator。

## 实施内容

- `SubagentCoordinator` 收敛为公开端口门面，只组合 Dispatcher 与 Delivery；
- `SubagentDispatcher` 独占请求准入、批量派遣、跨 Run 补位和清理编排；
- `SubagentRun` 独占 Snapshot、generation、execution epoch、Child Handle、Hook、终态和释放；
- `SubagentPool` 统一独占 ID/taskName 索引、FIFO 和并发槽位，替代独立 Store/Scheduler；
- `recovery` 以纯函数完整校验和规范化恢复状态；
- `SubagentDelivery` 完整接管 wait、timeout、waiter 和 generation claim；
- 初始模型消息投影通过 Port 注入，Coding Agent 组合层继续生成既有 `<subagent_task>` 文本；
- 删除 `internal.ts`、`scheduler.ts` 和 `subagent-store.ts`。

## 旧实现依赖变化

- Coordinator 直接 Child Handle 操作：多处降为 `0`；
- Coordinator 直接 Snapshot 状态赋值：多处降为 `0`；
- Coordinator 内恢复、wait、队列和 Lifecycle 私有方法：全部降为 `0`；
- Runtime Subagents 对 workspace 生产包依赖：保持 `0`；
- Coding Agent、Runtime Tools 的公开行为和持久化格式变化：`0`。

## 行为兼容性验证

- Runtime Subagents：29 项测试通过；
- Runtime Tools Subagent 工具与通知：6 项测试通过；
- Coding Agent Subagent Session 与持久化：9 项测试通过；
- Runtime Subagents 边界守卫：3 项测试通过；
- 独立 Runtime Subagents TypeScript 检查通过。
- `bun run check:quick` 通过；
- 根级 `bun run check` 通过，包括 Biome、Root/CLI/Desktop/Admin 类型检查和全部架构守卫。

新增场景覆盖 beforeStop/interrupt 竞争、Hook 异常补位、容量检查先于 reopen、异步 abort 后补位、观察回调异常隔离、重复 sessionId 拒绝和 Type Registry ID 规范化。

## 尚未完成的替换

本轮计划内的 Coordinator 职责拆分已经完成，没有保留旧 Store/Scheduler/Internal 文件或待迁移的 Coordinator 私有业务方法。`taskPath` 的 `/root/` 身份格式仍是现有公开兼容合同，不在本轮改变。
