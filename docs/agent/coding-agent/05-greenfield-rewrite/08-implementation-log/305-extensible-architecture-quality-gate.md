# 第 305 轮：可扩展架构质量门禁

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

第 304 轮建立了当前架构门禁，本轮校正其中过度冻结当前实现的规则。门禁继续阻止依赖方向回退，但普通能力、合同、公开子路径和历史格式内部职责拆分不再需要同步维护符号快照或具体文件白名单。

## 实施内容

- 删除包公开子路径的第二份固定清单，直接以 `package.json#exports` 为唯一事实来源，并支持通配符导出。
- 删除 Composition 公开符号精确清单，改为检查导出来源区域：允许根级能力、合同、Session Host 和明确的宿主合同，拒绝导出 Tool Surface、Session Initialization 等内部组装实现。
- Adapter 允许依赖 `composition/contracts`，继续禁止依赖 Composition 实现和 Public API facade。
- `migrateLegacySessionToV2` 的所有权从单个 `migration.ts` 放宽到完整 `sessions/legacy/**` 格式边界。
- 移除 `catalog.ts`、`lease.ts` 的文件写入白名单；历史格式域可以自行拆分存储职责，但仍不能依赖 Agent 执行。
- 保留包根 Extension facade、`src/core`/`src/compat` 退役目录、产品域依赖方向、历史格式执行隔离和非公开深层导入等长期规则。

## 旧实现依赖变化

- 旧实现、旧执行入口和 Runtime 反向依赖均未恢复。
- 放宽的是当前实现的文件名、符号名和公开子路径数量，不放宽层级反向依赖。
- `sessions/legacy` 仍是显式格式兼容边界，不成为活动 Session 执行入口。

## 行为兼容性验证

- 真实仓库架构扫描通过：403 个 Coding Agent 源文件、2332 条模块边、20 个 manifest 公开子路径。
- 架构门禁 12 项测试通过；新增合法公开子路径、Composition 根级能力、Adapter 合同依赖、历史转换器拆分和通配符导出正例。
- 非 manifest 深层导入、Composition 内部实现导出、Adapter 到 Composition 实现、历史格式到 Agent 执行等反例继续失败。
- `test:quality` 共 7 个文件、91 项通过，`bun run check:quick` 通过。
- 根 `bun run check` 全部通过，包括 Lint、Root/CLI/Desktop/Admin/Docs 类型检查及全部质量守卫。
- 本轮未修改 Coding Agent 运行时代码。

## 尚未完成的替换

没有新增旧实现替换债务。后续门禁调整遵循“功能扩展不改门禁，架构边界变化才改门禁”；如果新增顶层产品域，需要明确其所属层级，这是架构变更而不是普通功能扩展。
