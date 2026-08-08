# 第 306 轮：MCP 结果容量边界

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

本轮落实 Grok 上下文治理分析中的第一阶段：在 MCP Tool 域建立大结果容量边界。通用策略属于 `runtime-mcp`，文件持久化属于 Coding Agent 宿主适配器；Agent Kernel、会话文档和 Compaction 均不感知文件系统或 MCP 协议细节。

## 实施内容

- 在 `runtime-mcp` 新增可注入的 `McpToolResultPolicy` 与 `McpToolResultArtifactStore`，默认兼容策略仍保留完整结果。
- 结果超过 20,000 字节且存在产物存储器时，保存完整 MCP JSON，只向模型返回 UTF-8 安全的头尾预览、字节数和产物引用。
- 超限结果的 `details` 只保留错误状态、产物元数据和内容统计，不再重复携带完整文本、图片 Base64 或二进制资源。
- 图片模型内容保持原样；本轮不提前实现模型级图片字节水位，避免改变多模态功能。
- 产物写入失败时回退完整旧结果，容量治理不得造成数据丢失。
- Coding Agent 使用原子文件适配器写入 `agentDir/mcp-results/<session>/`，文件名和 Session 目录经过路径安全处理。
- 共享文件 MCP 和 Session-local 插件 MCP 通过同一个 Tool Source 选项接入结果策略。

## 明确未修改

- 未修改 Runtime Core Tool 合同、ConversationDocument 或模型调用管线。
- 未修改低于阈值的 MCP 内容、`details`、错误和动态工具行为。
- 未截断图片，也未引入 Tool、Skill、Prompt 或 MCP 能力快照。
- 未把 MCP 文件存储移动到 `runtime-mcp`，Runtime 包继续不依赖 Coding Agent。

## 旧实现依赖变化

- 未新增旧执行入口、Legacy Manager、兼容 Adapter 或 Runtime 到 Coding Agent 的反向依赖。
- MCP 结果治理直接建立在 Runtime-native Tool Source 上，不调用旧 Coding Agent 工具实现。
- 架构守卫继续通过：405 个 Coding Agent 源文件、2343 条模块边、20 个 manifest 公开子路径。

## 行为兼容性验证

- `runtime-mcp` 定向测试 3 个文件、10 项通过，覆盖小结果兼容、UTF-8 预览、大错误、图片与二进制资源、存储失败和客户端异常。
- Coding Agent 定向测试 3 个文件、6 项通过，覆盖原子文件产物、共享 MCP 默认接线和插件 MCP 动态策略接线。
- `bun run check:quick` 通过。
- 根 `bun run check` 全部通过，包括 Lint、Root/CLI/Desktop/Admin/Docs 类型检查及全部质量守卫。

## 尚未完成的替换

下一阶段应将现有基于“最近 8 个结果和 30 秒”的 microcompact 封装为可替换纯投影策略，先建立旧行为差分基线，再引入基于上下文压力和真实用户轮次的裁剪。能力定义继续在每次模型调用时动态组装，不进入压缩状态快照。
