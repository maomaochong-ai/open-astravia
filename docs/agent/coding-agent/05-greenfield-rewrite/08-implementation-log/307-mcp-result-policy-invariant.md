# 第 307 轮：MCP 结果策略不变量

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

第 306 轮建立了可选的 MCP 结果容量策略，本轮将“每个 MCP Runtime Tool 都经过一个结果策略”收紧为结构性不变量。通用 Runtime 默认使用显式 Preserve Policy，Coding Agent Composition 继续替换为大结果卸载策略。

## 实施内容

- 新增冻结的 `PRESERVE_MCP_TOOL_RESULT_POLICY`，集中表达完整保留的兼容语义。
- `McpRuntimeToolOptions.resultPolicy` 改为必需字段；Tool 工厂未收到选项时使用显式 Preserve Policy。
- Tool 执行不再判断策略是否存在，而是无条件调用 `resultPolicy.project()`。
- `McpServerRuntimeToolSource` 在刷新动态 Tool 前解析一次非空策略，运行期新增和重连生成的 Tool 使用同一策略合同。
- 保留三参数 `executeMcpToolCall` 的直接调用兼容，内部同样经过 Preserve Policy。

## 明确未修改

- 未改变 20,000 字节阈值、产物格式、预览比例或存储失败回退。
- 未改变动态 MCP 的注册、删除、重连和渐进披露行为。
- 未修改 Coding Agent、CLI、Desktop 或 IM 的策略接线。

## 旧实现依赖变化

- 未新增旧执行入口、Legacy Adapter 或 Runtime 到 Coding Agent 的反向依赖。
- 策略不变量完全位于 `runtime-mcp` Tool 域，不要求 Agent Kernel 解释 MCP。

## 行为兼容性验证

- `runtime-mcp` 定向测试 3 个文件、12 项通过，新增直接调用 Preserve Policy、完整执行身份和动态 Tool 默认策略覆盖。
- Coding Agent MCP 定向测试 3 个文件、6 项通过。
- `bun run check:quick` 通过。
- 根 `bun run check` 全部通过，包括 Lint、Root/CLI/Desktop/Admin/Docs 类型检查及全部质量守卫。

## 尚未完成的替换

后续按四个阶段推进：先建立普通 Coding Tool 的统一末端容量保护与 Session 产物生命周期；再建立基于压力、真实用户轮次和最近三轮保护的纯模型上下文投影；随后实现图片高低水位及 Compaction 输入降级、错误分类重试和摘要校验；最后实现压缩后的 Todo、任务和计划结构化恢复。能力定义仍按模型调用动态重建，不进入状态快照。
