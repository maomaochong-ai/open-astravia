# 第 252 阶段：Extension Setup 原生会话 Seed

## 阶段目标

在不改变 `Extension newSession.setup`、CLI、SDK、RPC、IM 和活动 Session 切换行为的前提下，删除“临时生成 Coding Agent Legacy JSONL，再迁移到 Conversation V2”的生产链路，使新会话 setup 从开始到激活始终使用原生 V2 结构化 seed。

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

- 新会话初始化不再借用历史格式，Legacy 会话迁移只处理真实存在的历史用户数据。
- `coding-agent` 只把 Extension Session 合同投影为结构化 Conversation entry；V2 schema、文件名、校验和发布原子性继续由 `runtime-storage` 拥有。
- setup writer 位于 `sessions/setup`，不再伪装为 `adapters/runtime-core` 下的 Legacy 适配器。
- 持久化输入属于不可信运行时边界，因此在现有 TypeBox record schema 中加入 `conversation.seed` 校验；内部静态 Session writer 不重复引入 Zod 或额外 schema。

## 本阶段实施内容

### 1. 增加原生 Conversation V2 Seed

- `runtime-storage` 新增 `conversation.seed` record，与 import seed、continuation seed 明确区分。
- codec 支持解析、图约束校验、名称恢复和后续 event/document operation 投影。
- 新增 `publishConversationSeed`、`resolveConversationFilePath` 和 `createConversationSeedDraft`；首次创建使用排他原子发布，setup 期间的同步更新使用临时文件替换，文件始终保持为可读取的 V2 文档。
- 重复目标继续返回 `ALREADY_EXISTS`，不会静默覆盖已有会话。

### 2. 重建 Extension Setup Writer

- 新增 `CodingAgentSessionSetupWriter`，保留原有同步 append、branch、reset、label、session name、tree、branch view 和 entry id 行为。
- `isPersisted()` 继续返回 `true`；setup 回调开始前最终 V2 路径已存在，每次 append 后回调可立即读取最新 V2 seed。
- `getSessionId()` 现在返回即将激活的真实目标 Session ID，`getSessionFile()` 返回最终 V2 路径，不再暴露临时 Legacy 文件。
- 新增 Session entry 到 Conversation document entry 的显式投影，保留标准消息、扩展 AgentMessage、custom message 可见性、compaction summary message 和 tool timing 语义。

### 3. 替换全部生产调用点

- CLI Greenfield Runtime Host、SDK Host 和 Composition 导出统一使用 `createCodingAgentSessionSetupSeedInitializer`。
- 删除 `CodingAgentLegacySessionSetupSeedImporter` 与 `LegacySessionSetupWriter`。
- 活动 Session Host 的事务顺序不变：完成 seed 初始化后 resume，任一步失败仍删除本次创建的目标并恢复源 Session 生命周期。

### 4. 冻结零回流方向

- 两个已删除文件加入退役文件清单，恢复任一文件会使质量守卫失败。
- 新增语义守卫：任何生产文件恢复旧 setup writer/importer 符号都会失败；除独立历史迁移适配器外，任何生产文件重新调用 `migrateLegacySessionToV2` 都会失败。
- 守卫输出新增 `native setup migration edge(s)` 指标，本阶段基线为 `0`。

## 旧实现依赖变化

| 指标 | 本阶段前 | 本阶段后 | 最终目标 |
| --- | ---: | ---: | ---: |
| 新会话 setup 到 Legacy migration 的生产边 | 1 | 0 | 0 |
| 活动 Legacy setup writer/importer 文件 | 2 | 0 | 0 |
| 新会话生成的 Legacy JSONL 文件 | 1 | 0 | 0 |
| 原生 `conversation.seed` record | 0 | 1 | 1 |
| 明确保留的历史格式读取边界 | 8 | 8 | 按历史迁移需求独立审计 |
| 生产代码到旧 Core 的依赖边 | 0 | 0 | 0 |

## 行为兼容性验证

- `runtime-storage` 定向测试 2 个文件、13 项通过，覆盖 native/import/continuation seed 图约束、原生发布、重复目标、同步 draft 更新和 native seed 会话 fork。
- `coding-agent` 定向测试 3 个文件、19 项通过，覆盖活动 Session 事务、Legacy 历史格式读取以及 setup 的持久化可见性、分支、Label、名称和扩展消息投影。
- 质量守卫测试 57 项通过；独立退役守卫报告 `0 native setup migration edge(s)`。
- `bun run check:quick` 通过。
- `bun run check` 的全仓 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫通过。

## 尚未完成的替换

- 新会话 setup 生产链路已经完全摆脱 Legacy JSONL 与迁移器，没有本阶段遗留的替换项。
- 仍保留的 `migrateLegacySessionToV2` 只服务真实历史会话迁移，不参与新会话生成；其去留必须由历史数据兼容期限决定，不能为追求数字归零直接删除。
- 后续应继续最终架构验收：审计 8 个历史格式边界的真实宿主消费者，并执行独立安装产物下的 CLI/SDK 新建、恢复和 Extension setup 端到端验证。
