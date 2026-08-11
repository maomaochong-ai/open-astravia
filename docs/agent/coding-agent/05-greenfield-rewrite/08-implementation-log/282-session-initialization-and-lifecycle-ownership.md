# 第 282 轮：Session 初始化与生命周期所有权收口

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

第 281 轮确认 Composition 根仍混合 Session 初始化、资源生命周期和具体宿主能力。本轮按职责拆开这一完整闭环：
Composition 只负责创建顺序、依赖编排、索引和资源释放事务；会话执行上下文、动态配置状态与后台任务控制归 Host。

这不是功能重写。会话创建、恢复、插件重配置、后台任务、动态 Tool、MCP、初始化失败回滚、Session 替换和 Composition
关闭的既有时序与错误语义均保持不变。本轮也没有抽离新 workspace 包：这些能力仍属于 `coding-agent`，只是在包内建立明确层次。

## 实施内容

### 具体 Session Host 能力归位

- 将会话执行实现迁入 `host/session-execution/execution-runtime.ts`，稳定名称为
  `CodingAgentSessionExecutionRuntime`；
- 将后台任务与 Subagent 工作控制迁入 `host/session-execution/background-work-controller.ts`；
- 将动态工具配置、插件重配置和会话配置状态迁入
  `host/session-configuration/configuration-state.ts`；
- 删除 Composition 下对应的迁移文件，不提供旧名称别名、转发文件或兼容包装。

这些类会直接执行或持有宿主侧状态，因此不属于 Composition。Composition 可以构造和连接它们，但不能声明它们的实现。

### Session 初始化子域

将初始化闭环整理到 `composition/session-initialization/`：

- `profile.ts` 只把公开 Composition Options 投影为窄初始化输入；
- `peripheral-assembly.ts` 负责装配模型、配置、执行器、资源和插件外围能力；
- `context-assembly.ts` 负责 Context、Memory、Todo、Hook 和 Turn 能力所需上下文；
- `transaction.ts` 负责分阶段初始化与逆序回滚，不直接实现具体能力。

类型与工厂统一采用 `CodingAgentSession*` 稳定名称，生产调用方直接引用真实实现路径。

### Session 生命周期子域

将资源所有权闭环整理到 `composition/session-lifecycle/`：

- `indexes.ts` 保存 Session 到运行时资源的窄索引；
- `resource-registry.ts` 统一登记同步、异步和可重试清理资源；
- `runtime-resources.ts` 投影单个 Session 运行期间的资源集合；
- `resource-lifecycle.ts` 负责资源创建、绑定、替换与释放编排；
- `session-controls.ts` 和 `extension-controls.ts` 提供稳定的宿主控制面；
- `composition-shutdown.ts` 执行 Composition 级关闭事务。

MCP、Tool、Subagent 和 Turn 的现有具体实现不在本轮机械迁移范围内；它们只切换到新的稳定生命周期合同。

### 防回退门禁

- 迁移残留门禁永久禁止 13 个旧 Composition 文件及对应旧类型、工厂和模块引用重新出现；
- Composition 中 `greenfield-*` 文件基线由 `24` 收紧为 `11`；
- 新增 AST 所有权门禁，禁止 Composition 声明执行器、配置状态、后台控制器和 Subagent 工作 Host 合同；
- 更新初始化、资源生命周期、关闭事务和 Runtime Host Controls 的边界 fixture，使其检查真实稳定路径；
- 相关测试文件切换为稳定职责命名，不保留对旧文件结构的断言。

本轮没有引入 TypeBox 或 Zod。调整后的输入仍是同进程内、由 TypeScript 约束的组合参数，没有新增 JSON、配置文件、IPC
或外部协议载荷；此处增加运行时 Schema 只会重复静态合同。后续若这些边界接收不可信结构化数据，应在最外层适配器引入
TypeBox 或 Zod，而不是放入内核或 Composition。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本轮 13 个旧 Composition 实现文件：删除；
- 受管生产源码与测试中的本轮旧路径、旧类型和旧工厂引用：归零；
- Composition 中 `greenfield-*` 文件：`24 -> 11`；
- Adapter 中 `greenfield-*` 文件：保持 `30`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`；
- Composition 公开导出仍为 `18`，没有新增兼容层或改变用户可观察功能。

## 行为兼容性验证

本阶段定向 Session 行为测试：

```text
11 files passed
22 tests passed
```

覆盖后台任务隔离、Session 观察事件、插件重配置、动态扩展 Tool、MCP 索引、初始化逆序回滚、同 Session 重新启动、资源关闭和
Turn 能力绑定。质量门禁定向测试为 2 个文件、75 项测试，全部通过。

完整 Coding Agent 包验证：

```text
136 files passed, 1 skipped
934 tests passed, 17 skipped
```

根级 `bun run check:quick` 与 `bun run check` 全部通过；完整检查包含根、CLI、Desktop 和 Admin 的独立 TypeScript 检查。
迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=30/30
Composition greenfield files=11/11
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

`bun run verify:agent-hosts` 通过，完成独立 `vetta.exe` 编译、IM Gateway Go 套件、Coding Agent 功能套件和 Desktop 套件；
现有 CLI canary 实际完成持久会话创建、继续和列表读取，最终结果为 `coding-agent, CLI, Desktop, IM` 全部 `ok`。
本轮没有发送外部真实模型请求。

## 尚未完成的替换

- Composition 仍有 11 个、Adapter 仍有 30 个 `greenfield-*` 文件，需要继续按完整职责簇审计，不能批量改名；
- Composition 中 MCP、Tool Surface、Subagent 与 Turn Capability 仍保留迁移身份，下一轮应选择一个有独立行为闭环的职责簇；
- Desktop 的 `greenfield-runtime` 仍表达迁移阶段，需要单独确认宿主候选命名、历史格式兼容和生产入口所有权；
- 后续必须继续保持动态 Tool、Prompt、Skill 和 MCP 在明确刷新边界生效，不得以静态化运行时能力换取架构简化；
- 每轮仍需同步收紧旧路径门禁，并通过 CLI、Desktop、IM、SDK 行为测试证明功能兼容。

下一阶段优先审计 Composition 中剩余的 MCP Session Coordinator 与 Runtime Tool Surface：两者共同承担动态 Tool 视图与 MCP
刷新闭环，应先判断 Tool Registry、MCP Host 和 Composition 的真实边界，再作为一个阶段稳定所有权与命名。
