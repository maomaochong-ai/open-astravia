# Coding Agent 全面重写固定目标合同

本合同从第 225 阶段开始约束后续实施记录。ADR-0077 根据新的三层所有权决策将其升级为 v2；历史
记录中的 v1 区块保持原样，不追溯修改。

<!-- coding-agent-rewrite-charter:v2:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `agent` 最终只承担单次模型与工具执行闭环，不依赖 Runtime、产品或平台包。
- `runtime-core` 最终只承担产品无关的 Session、Turn、Queue、Snapshot、生命周期、Port 与 Extension 机制。
- `coding-agent` 最终只承担 Coding Agent 产品定义、Feature、策略和产品 API 语义映射。
- 最终平台 Composition Root 与环境实现由现有平台 Runtime 或应用宿主承担，不为职责收敛创建新包。
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
- `agent` 对任何 `runtime-*` 包的反向依赖，以及 `coding-agent` 对具体平台默认实现的产品域依赖。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v2:end -->

## 后续实施记录要求

新的实施记录必须引用 ADR-0077，并原样包含上述 v2 固定区块；历史 v1 记录不修改。每份记录还需记录：

- 本阶段与最终目标的关系。
- 旧实现依赖的基线变化。
- 行为兼容性验证。
- 尚未完成的替换。
