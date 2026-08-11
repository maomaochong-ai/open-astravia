# 第 242 阶段：Session 策略、Prompt Resource 与 Work State 领域闭环

## 阶段目标

在不改变 Tool、Skill、Scene、Todo、Prompt、Memory、Subagent、CLI、SDK 和 RPC 可观察行为的前提下，退出旧 `core/session` 行为实现，把会话场景策略、提示词资源展开、工作状态和只读会话投影归入明确的产品领域。

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

第 241 阶段删除了旧 Session 执行闭包，但场景激活、资源展开、Todo 状态、系统提示词组装和 Session 观察函数仍留在旧 `core/session`。本阶段把这些能力改造成 Greenfield 组合直接消费的领域合同，避免重新形成新的 Session Manager，也不把具体 Tool 实现迁回 Coding Agent。

## 实施内容

### 1. Profile 领域

- 新增 `src/profiles`，集中维护 `ConversationScenario`、`AgentMode`、Tool capability/category 和纯激活策略。
- `scope_use` 保持 fail-closed，`requires` 保持全满足才激活，`agent_mode` 继续作为正交过滤轴。
- Persona、Mode Prompt、生成数据和提示词源文件一并归入 Profile 领域，构建期生成脚本改写到新路径。
- 包根和稳定 `public-api/profile` 不再引用旧 `core/agent-mode` 或 `core/session/tool-scope`，也不再公开具体 `CodingAgentTool` 别名。

### 2. Prompt Resource 领域

- 新增 `src/resources/prompt-resources`，拆分 Skill block 解析、结构化 Skill/Scene 引用展开和依赖合同。
- Scene 展开不再接触具体 Todo Store，只依赖 `readSceneTodoState` 和 `initializeSceneTodoItems` 两个窄能力。
- 保留 Skill 删除后不复用旧内容、Scene 只读提示、`tasks.json` 自动建项、锁定列表重入和错误上报行为。

### 3. Work State 领域

- 新增 `src/work-state`，分别承载 Todo 值合同、状态、持久化快照校验和 continuation 规则。
- `CodingAgentTodoRuntime` 成为 Session 内唯一状态所有者；Tool 注册、Prompt Resource、Continuation 和宿主 Controller 只看到各自所需的窄端口。
- TypeBox 仅用于反序列化 `todo_snapshot` 的不可信持久化边界，内部状态不增加重复校验。
- 旧 `core/todo-store.ts` 只保留旧 Core Tool 的类型兼容转发，不再含状态实现。

### 4. Session 观察与 Subagent Profile

- 会话统计、用户消息文本和最后助手文本迁入 `src/sessions/projection/session-observations.ts`，保持为无状态纯投影。
- Explorer/Workflow 的产品提示词和 Profile 迁入 `src/composition/greenfield-subagent-profiles.ts`；通用调度仍由 `runtime-subagents` 提供，Tool 仍由 `runtime-tools` 提供。
- `core/session` 只剩旧 Core Tool 编译所需的类型转发 `tool-scope.ts`，不再承载 Session 运行时行为。

### 5. 防回流治理

- Legacy retirement 守卫登记本阶段删除的 Agent Mode、Session Support、Persona 和 Mode Prompt 旧文件，禁止恢复。
- Greenfield 产品 Core 预算收紧为 Adapter 12、Composition 0、RPC 2、SDK 0。
- 新增兼容转发检查，禁止在 `core/session/tool-scope.ts` 和 `core/todo-store.ts` 中重新引入激活函数或 Todo 状态类。
- 重写精确基线仅在实现和测试稳定后重新生成。

## 行为兼容性验证

- Profile 激活测试覆盖场景、fail-closed、capability 和 agent mode 四个过滤维度。
- Prompt Resource 测试覆盖 Skill 动态刷新/删除、Scene `tasks.json` 初始化和锁定状态。
- Todo Runtime 测试覆盖 Tool、Controller、持久化、分支恢复和非法快照拒绝。
- Continuation、Stop Hook、Tool Adapter、System Prompt 和 Subagent Session Assembly 特征测试保持通过。
- 根 TypeScript `tsgo --noEmit`、`check:quick`、治理守卫和完整 `bun run check` 作为最终交付门禁。
- CLI continuation 集成测试在收集阶段受本地 `@vetta/runtime-knowledge` 未构建入口阻断；该测试未出现断言失败，Coding Agent 同行为由包内特征测试覆盖。

## 旧实现依赖变化

| 指标 | 第 241 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 69 | 46 | 0 |
| Session / Agent Mode / Todo Store 旧依赖边 | 19 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 107 | 98 | 0 |
| Greenfield 产品 Core 依赖边 | 约束预算 94 | 14 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 仍有 46 条旧产品 Core 依赖和 98 个旧实现文件；最大剩余领域是 Model Registry、Bash、MCP、Auth、Export HTML 和 Memory。
- `core/session/tool-scope.ts` 与 `core/todo-store.ts` 仍是旧 Core Tool 的编译期兼容转发。它们没有运行时行为，待旧 Core Tool 整体退役时一起删除。
- `core/subagents` 还保留旧 Subagent 调度和 Tool 工厂；Greenfield 产品 Profile 已不再依赖其 Explorer/Workflow 实现，下一阶段可单独审计剩余一条生产依赖。
