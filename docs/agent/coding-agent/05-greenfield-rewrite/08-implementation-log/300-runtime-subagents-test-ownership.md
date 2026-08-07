# 第 300 轮：Runtime Subagents 测试职责拆分

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

第 299 轮已完成 Runtime Subagents 生产职责拆分，但验证这些职责的 29 个场景仍集中在单个 738 行测试文件。该结构不会产生生产依赖，却会模糊公开 API、调度、交付、恢复、生命周期和关闭之间的验证边界。

本轮只对测试所有权进行同构拆分，使测试结构能够持续验证新生产架构，而不保留对旧聚合测试结构的依赖。

## 实施内容

- 删除 738 行的聚合测试 `test/coordinator.test.ts`。
- 将 Coordinator 场景拆为公开 API、调度、交付、恢复、生命周期和关闭六组测试。
- 将 `SubagentTypeRegistry` 测试独立为类型注册职责文件。
- 将数据构造器、Coordinator Fixture、子会话桩和异步等待工具拆入 `test/support/` 的四个模块。

## 旧实现依赖变化

- 聚合 `coordinator.test.ts`：1 个降为 `0`。
- 按生产职责组织的测试文件：0 个增为 7 个。
- Runtime Subagents 对旧 Coding Agent 生产实现的依赖：保持 `0`。
- `packages/runtime-subagents/src` 生产实现变化：`0`。
- 用户可观察行为、公开合同和 Vitest 运行入口变化：`0`。

## 行为兼容性验证

- `packages/runtime-subagents` 执行 `bun run test`：7 个测试文件、29 个测试全部通过。
- 既有测试场景和断言未新增、删除或改写，测试总数保持 29。
- 根目录执行 `bun run check`：Biome、monorepo/CLI/Desktop/Admin 类型检查及全部质量门禁通过。
- 根目录最终执行 `bun run check:quick`：通过。

## 尚未完成的替换

本轮计划内的测试职责拆分已经完成，没有遗留聚合 Coordinator 测试文件。生产架构后续工作仍以固定重写目标和后续阶段评估为准；本轮未引入新的兼容层或待迁移实现。
