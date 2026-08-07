# 第 284 轮：Composition Subagent、Turn 与 Conversation 身份收口

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

第 283 轮完成 Tool Surface 编排所有权收口后，Composition 还剩 8 个以 `greenfield-*` 命名的迁移期模块，集中在
Subagent、Turn Capability 和 Conversation Persistence。本轮按完整职责簇收口这些模块，使 `coding-agent` 的 Composition
只使用稳定产品身份，同时保持通用能力的所有权不变：

- `runtime-subagents` 继续拥有通用父子 Agent 协调能力；
- `coding-agent` 只负责子 Session 创建、能力投影、生命周期连接和产品默认策略；
- Conversation Persistence 继续通过显式 Port 组合文件或内存存储；
- Turn Capability Assembly 只负责将当前 Session 能力组装到 Turn，不承担工具或模型实现。

这不是批量改名。每个迁移期模块都先审计了职责、调用方向和行为测试；稳定模块不保留旧路径转发、类型别名或兼容包装。

## 实施内容

### 稳定 Subagent Composition 子域

将 Subagent 编排整理到 `composition/subagent/`：

- `profiles.ts` 定义 Coding Agent 产品的默认 Subagent Profile；
- `child-handle.ts` 连接子 Session 句柄与运行时协调器；
- `child-composition-policy.ts` 表达父子 Session 的产品组合策略；
- `state-persistence.ts` 负责 Subagent 状态的 Session 持久化边界；
- `runtime.ts` 组装通用 Subagent Runtime；
- `session-assembly.ts` 完成子 Session 创建、恢复、能力限制和资源释放。

生产类型、常量和工厂统一使用 `CodingAgent*` 稳定身份。旧 `Greenfield*` 类型、
`createDefaultGreenfield*` 和 `createGreenfield*` 工厂均已移除，没有保留别名。

### 稳定 Turn 与 Conversation Composition 子域

- `composition/turn/capability-session-assembly.ts` 负责 Turn 级能力装配；
- `composition/conversation/persistence.ts` 负责文件或内存 Conversation Persistence 的选择与创建。

Runtime Composition、Session 初始化、Session 生命周期和 SDK Storage 调用方全部改用稳定路径和稳定合同。旧文件路径不再参与生产构建。

### 数据与行为兼容

Subagent 持久化记录的自定义类型值继续使用 `subagent_state_v1`。这是已写入会话历史的数据协议，不因内部 TypeScript 标识符改名而变化。
父子上下文投影、七个 Subagent 控制工具、非递归委派、后台通知、状态恢复、Conversation 文件/内存选择以及资源释放顺序均保持原行为。

本轮保留了 Subagent 持久化边界已有的 Zod 校验，因为会话历史属于不可信的结构化持久化输入。其他变更均为进程内静态类型组合，
没有新增 TypeBox 或 Zod Schema。

### 防回退门禁

- 迁移残留门禁永久禁止 8 个旧 Composition 文件重新出现；
- 永久禁止本轮旧路径、旧 `Greenfield*` 类型、工厂和常量重新进入受管源码与测试；
- Composition 中 `greenfield-*` 文件基线由 `8` 收紧为 `0`；
- Package Boundary 门禁改为检查稳定 Subagent、Turn Capability 和 Child Composition 所有权；
- 新增迁移残留 fixture，证明旧 Subagent、Turn 与 Conversation 身份会被拒绝。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本轮 8 个迁移期 Composition 模块：删除；
- 受管生产源码与测试中的本轮旧路径、旧类型、旧工厂和旧常量引用：归零；
- Composition 中 `greenfield-*` 文件：`8 -> 0`；
- Adapter 中 `greenfield-*` 文件：保持 `29`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`；
- Composition 公开导出仍为 `18`，没有新增兼容入口。

迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=29/29
Composition greenfield files=0/0
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

## 行为兼容性验证

本阶段定向行为测试覆盖 Subagent State Persistence、Subagent Session Assembly、Child Composition Policy、Turn Capability Assembly
和 Session Resource Lifecycle：

```text
5 files passed
12 tests passed
```

架构与迁移门禁为 3 个文件、101 项测试，全部通过。完整 Coding Agent 包验证：

```text
137 files passed, 1 skipped
935 tests passed, 17 skipped
```

CLI 中与 Runtime Composition、Subagent Runtime 直接相关的 2 个文件、17 项测试通过。根级 `bun run check:quick` 与
`bun run check` 全部通过；完整检查包含根、CLI、Desktop 和 Admin 的独立 TypeScript 检查。

完整 `bun run verify:agent-hosts` 成功，验证结果包括：

- 独立 `vetta.exe` 编译通过；
- IM Gateway 全量 Go 套件通过；
- Coding Agent 功能套件通过；
- CLI 功能套件 34 个文件、183 项测试通过；
- Desktop 功能套件 119 个文件、501 项测试通过，另 1 项跳过。

本轮没有发送外部真实模型请求。

## 尚未完成的替换

- Coding Agent Composition 的迁移期文件身份已经归零，但 Adapter 仍有 29 个 `greenfield-*` 文件；
- 剩余 Adapter 不能批量改名，需要按模型调用、Prompt、Extension、Tool 和 Session 边界分别审计，确认它们是必要合同转换还是迁移兼容层；
- CLI 与 Desktop 宿主仍存在迁移期命名，应在 Coding Agent Adapter 职责收口后单独审计生产入口、历史格式迁移和宿主所有权；
- 当前门禁证明旧执行入口、旧 Composition 身份和反向依赖没有回流，但还不能据此宣称整个仓库的迁移命名已经清零。

下一阶段应审计完整的模型调用与 Prompt Adapter 职责簇，包括消息终结、调用组合、Prompt Resource 解析、Agent Message Context 投影和
Conversation Context Overlay。目标是区分稳定的外部合同转换与迁移期包装：必要 Adapter 使用稳定产品身份保留，只为旧调用方式存在的层直接删除，
并继续以模型消息、工具调用顺序、Prompt 动态刷新和三个宿主功能门禁证明行为兼容。
