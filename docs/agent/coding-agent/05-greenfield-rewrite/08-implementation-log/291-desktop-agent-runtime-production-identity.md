# 第 291 轮：Desktop Agent Runtime 生产身份收口

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

第 290 轮完成 Extension 宿主兼容合同后，Desktop 生产入口已经直接创建新 Runtime Composition，但实现仍位于 `main/greenfield-runtime`，核心类型仍使用 `DesktopGreenfield*`，并保留一个只被自身测试引用的 Candidate 包装层。目录和类型表达的是迁移候选，实际运行身份却已经是唯一生产实现。

本轮不重写任何 Agent 功能，而是让代码身份与真实所有权一致：Desktop 只保留一个 `agent-runtime` 生产组合根；旧会话只作为 Historical Data 导入，不再作为 Legacy 执行实现；原差分测试保留行为场景，改为生产合同测试。

## 实施内容

### 生产目录与类型身份

- `packages/desktop-app/src/main/greenfield-runtime` 迁移为 `main/agent-runtime`；
- `DesktopGreenfieldRuntimeBackendPool` 改为 `DesktopRuntimeBackendPool`；
- `DesktopGreenfieldRuntimeSessionCatalog` 改为 `DesktopRuntimeSessionCatalog`；
- MCP Scope、Managed Source、Backend Entry 等内部类型去除 Greenfield 迁移前缀；
- Composition、Lifecycle、Host Services、Backend Pool、Session Catalog 使用职责名文件；
- Desktop `runtime.ts`、模型设置、AI Capability、Knowledge Poller 和 CLI canary 全部改用生产路径。

### Candidate 与迁移测试退役

- 删除 `DesktopGreenfieldRuntimeCandidate` 及其专属测试；
- 删除依据：生产入口、CLI canary 和其他宿主均不引用 Candidate，它只是重复包装已经正式使用的 RuntimeHost 与 Backend Pool；
- 原 `differential`、`cutover readiness` 测试改为 RuntimeHost 与 Model Call Frame 生产合同测试；
- Tool Loop、持久化恢复、历史编辑、分支、动态 Skill、Plugin、MCP 和多 Session 隔离场景全部保留。

### Historical Data 边界

- `desktop-legacy-session-format-compatibility.ts` 改为 `historical-session-format.ts`；
- 工厂改为 `createDesktopHistoricalSessionFormat()`，变量改为 `historicalFormat`；
- 历史 JSONL 的发现、读取、重命名、删除和导入行为不变；
- `DesktopHistoricalSessionImportBackend` 保留，它在打开生产 Runtime 前显式迁移旧数据，不提供旧执行路径。

### 明确保留的 Greenfield/Legacy 语义

- `@vetta/runtime-core` 的 `GreenfieldRuntimeSession` 仍是跨包正式 Session 类型，本轮不修改；
- 历史格式测试中的 Legacy 执行符号只作为禁止回归断言存在；
- 历史会话数据版本和既有协议判别值不变；
- 没有引入 Legacy Runtime、自动回退或双后端选择。

### 类型校验判断

本阶段只重命名进程内 TypeScript 类型与路径，没有新增外部不可信结构化输入。历史 JSONL 继续由既有历史会话解析和迁移边界校验，因此无需新增 TypeBox 或 Zod。

## 防回退门禁

迁移残留门禁现在同时扫描 Desktop Main：

- `main/greenfield-runtime` 下的文件必须为 `0`；
- `desktop-greenfield-*` 和 `*-differential.*` 文件必须为 `0`；
- `DesktopGreenfield*` 类型与函数身份必须为 `0`；
- 上游 `GreenfieldRuntimeSession` 不匹配 Desktop 专属规则，允许继续作为正式合同；
- 历史格式和历史导入的新路径进入 Legacy Format 数据兼容白名单；
- Runtime Failure Contract 与 Package Boundary 白名单同步到生产路径。

## 旧实现依赖变化

- 旧 Desktop Runtime 目录文件：`18 -> 0`；
- Candidate 生产文件与专属测试：`2 -> 0`；
- Desktop Runtime 迁移文件统计：`0/0`；
- Desktop Runtime 迁移身份统计：`0/0`；
- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 历史格式兼容边界：继续保留为数据边界，不计入执行入口。

## 行为兼容性验证

- Desktop Agent Runtime 定向测试：10 个文件、35 项通过；
- 生产合同清理后的核心复跑：3 个文件、20 项通过；
- Vetta CLI → Desktop Local RPC → Agent Runtime canary：1 项通过，覆盖创建、继续、列举和持久化会话；
- 迁移残留门禁测试：21 项通过；
- `bun run check:quick` 通过，Desktop Runtime 迁移文件与身份均为 `0/0`；
- 根级 `bun run check` 通过：Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫通过；
- 本轮未发送外部真实模型请求，模型调用使用本地 OpenAI Responses 测试服务器。

## 尚未完成的替换

- `GreenfieldRuntimeSession` 是 Runtime Core 当前正式类型名称，是否进一步稳定命名必须在其跨包合同所有者中单独评估，不能由 Desktop 私自改名；
- Desktop Runtime 已脱离迁移身份，下一阶段应审计 CLI/IM 宿主中仍保留的协议级 Greenfield 名称，区分正式协议值与可退役的宿主迁移身份；
- 本轮没有改动 CLI/IM 的协议判别值、会话格式或功能实现。
