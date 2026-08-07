# 第 286 轮：Extension、Plugin、Continuation 生产边界收口

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

第 285 轮后 Adapter 中仍有 21 个 `greenfield-*` 文件，其中 13 个集中承载 Extension、Plugin、Continuation、Compaction 和 Todo
继续执行职责。本轮逐个判断它们是合同转换、产品运行时还是 Composition 策略，并按实际所有权收口；没有保留旧路径转发、旧类型别名或兼容包装。

审计同时发现 Plugin MCP 运行时会反向依赖 `adapters/runtime-core` 中的 MCP Supervisor 和 Tool Source。二者实际是
Coding Agent 的 MCP 产品运行时，而非宿主 Adapter，因此一并移入 `mcp/runtime`，消除产品域到 Adapter 的反向依赖。

## 实施内容

### 稳定 Extension Runtime 合同

Extension Runner、Tool Source、Session Tool Registration 和 Event Binding 改用稳定生产身份：

- `CodingAgentExtensionRunnerPort`；
- `CodingAgentExtensionToolSource`；
- `CodingAgentSessionToolRegistration`；
- `CodingAgentExtensionEventBinding`。

旧 `CodingAgentGreenfield*` 身份被直接删除，没有兼容别名。Extension Tool Runtime 与 Stop Hook Continuation Source 归入
`extensions/runtime`；Extension Run、Observation 和 Tool Wrapper 仅保留为 Runtime 合同与现有 Extension 系统之间的真实 Adapter。

### Plugin 与 Continuation 所有权

- Plugin MCP、Run、Tool 和 Runtime Effect Schema 归入 `plugins/runtime`；
- Continuation Orchestrator 归入 `composition/turn`，只负责 Todo、Plugin、Stop Hook 的优先级编排；
- Todo Continuation Source 归入 `work-state`；
- Compaction Extension Adapter 归入 `adapters/extensions`；
- MCP Supervisor 和 Tool Source 归入 `mcp/runtime`。

Composition、Session 生命周期、SDK Host、公开 API 和测试均改为直接引用这些正式领域路径。动态 Extension、Plugin Tool、MCP Tool、
Session Tool Overlay、Stop Hook 和 Todo 的运行语义未改变。

### 类型校验判断

Plugin Runtime Effect 的外部贡献仍使用既有 TypeBox Schema 进行运行时校验，本轮迁移后继续保留。其余新增边界均为进程内组合关系，由
TypeScript 合同约束；没有新增不可信结构化输入，因此未额外引入 Zod 或重复 Schema。

### 防回退门禁

- 迁移残留门禁永久禁止本轮 13 个旧 `greenfield-*` Adapter 文件、2 个错误归属的 MCP Adapter 文件及旧路径和符号重新出现；
- Adapter 中 `greenfield-*` 文件基线由 `21` 收紧为 `8`；
- Package Boundary 门禁新增 `extensions`、`plugins`、`work-state` 和 `mcp` 产品域，禁止它们导入具体 Adapter；
- Runtime Port 所有权门禁识别新的实现根和稳定 Extension 合同，继续保证 Port 只有一处声明；
- 门禁 fixture 验证旧 Extension、Plugin、Continuation 和 MCP 身份会被拒绝。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本轮退役的迁移期 Adapter 文件：`13`；
- 归位的 MCP 产品运行时文件：`2`；
- Adapter 中 `greenfield-*` 文件：`21 -> 8`；
- Composition 中 `greenfield-*` 文件：保持 `0`；
- Extension、Plugin、Work State、MCP 产品域到具体 Adapter 的导入：`0`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`。

迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=8/8
Composition greenfield files=0/0
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

## 行为兼容性验证

- 新增和更新的架构门禁：2 个文件、82 项测试通过；
- Coding Agent 全量：137 个文件通过、1 个文件跳过，935 项通过、17 项跳过；
- 根级 `bun run check:quick` 通过；
- 根级 `bun run check` 通过，覆盖根、CLI、Desktop、Admin 类型检查、Biome 和全部质量门禁；
- `bun run verify:agent-hosts` 通过：独立 `vetta.exe` 编译成功，IM Gateway、Coding Agent、CLI、Desktop 全部通过；
- Desktop 功能套件为 119 个文件、501 项测试通过，另 1 项跳过。

首次定向测试发现一项旧错误文案断言，更新为稳定 Extension Run Adapter 身份后通过。首次快速检查又发现 MCP Tool Source
移动后仍按旧目录解析 Hook 元数据类型；随后将共享类型归入 `extensions/runtime`，消除了无效路径和 MCP 到 Adapter 的反向依赖。
本轮没有发送外部真实模型请求。

## 尚未完成的替换

- Adapter 中还剩 8 个 `greenfield-*` 文件：Ask User Question、Invoke Skill、Product Tools、Sandbox、Subagent Tool、Todo、Memory 和 MCP Deferred；
- 这 8 个文件需要继续区分产品能力装配、状态域和真实合同转换，不能仅批量改名；
- `runtime-core`、CLI、Desktop 和测试中仍有其他迁移期命名，需要按生产身份和行为边界继续审计；
- 历史 Session 格式读取边界仍需保留，它不属于旧执行架构。

下一阶段应一次性审计剩余 8 个 Adapter：让 Tool 实现继续留在 `runtime-tools`，Coding Agent 只保留产品激活与宿主能力装配；将 Todo、Memory
状态运行时归入各自领域；确认 MCP Deferred 是否仍有生产调用后保留真实 Adapter 或直接删除。阶段完成标准是 Adapter `greenfield-*` 基线继续
收敛、旧执行入口保持为零、全量 Coding Agent 与三宿主验证保持通过。
