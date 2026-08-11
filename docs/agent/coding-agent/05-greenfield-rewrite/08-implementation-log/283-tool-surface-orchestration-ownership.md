# 第 283 轮：Tool Surface 编排所有权收口

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

第 282 轮把 Session 初始化和生命周期从迁移期 Composition 文件中拆出，但剩余的 MCP Session Coordinator、Runtime Tool
Surface、工具激活策略和模型工具顺序仍混用迁移身份，且纯产品策略被放在 Adapter 中。本轮收口这一完整职责簇：

- `runtime-tools` 继续拥有工具实现、工具目录和通用工具运行时；
- `runtime-mcp` 继续拥有通用 MCP Tool Source、同步器和延迟激活控制器；
- `coding-agent` 的 Composition 只拥有 Session 级 Tool/MCP overlay、刷新、索引和释放编排；
- 纯产品激活和模型顺序规则由 `coding-agent` 内部 `tool-policy` 持有，不属于 Adapter。

这不是功能重写，也没有新建 workspace 包。动态 Tool、MCP 增删、延迟激活、插件覆盖、模型调用顺序和 Session 释放行为保持不变。

## 实施内容

### 稳定 Tool Surface 子域

将相关编排整理到 `composition/tool-surface/`：

- `runtime-tools-composition.ts` 连接 `runtime-tools` 提供的工具能力；
- `mcp-session-coordinator.ts` 维护 Session 级 MCP Source、同步器、索引和释放；
- `runtime-tool-surface.ts` 汇总基础工具、插件工具、MCP 工具与动态激活视图。

生产类型和工厂统一使用 `CodingAgent*` 稳定身份，包括
`CodingAgentMcpSessionCoordinator`、`createCodingAgentMcpSessionCoordinator`、
`CodingAgentRuntimeToolSurface` 和 `createCodingAgentRuntimeToolSurface`。旧 `greenfield-*` 模块、类型和工厂没有保留别名或转发层。

### 产品 Tool Policy 归位

新增内部 `tool-policy/` 子域：

- `activation-policy.ts` 只表达 Coding Agent 产品工具启用规则；
- `model-tool-order.ts` 只表达发给模型的稳定工具顺序。

模型工具顺序不再由 `adapters/runtime-core` 声明。Adapter 只完成运行时合同转换，Composition 只负责装配，两者均消费独立策略。

### 动态刷新与资源释放验证

新增真实 `CodingAgentRuntimeToolSurface` 行为测试，验证：

- 初始 MCP Source 注册到 Session Tool Surface；
- 默认 scoped 工具激活结果保持兼容；
- MCP Source 在 Session 存续期间从 `alpha` 变为 `beta` 后，下次刷新正确移除旧工具并注册新工具；
- `dispose()` 注销最终 MCP 工具，资源不泄漏。

这直接验证运行时能力变化，而不是依赖静态快照或只检查文件结构。

### 防回退门禁

- 迁移残留门禁永久禁止 5 个旧模块及旧 Tool Surface、MCP Coordinator、激活策略身份重新出现；
- Composition 中 `greenfield-*` 文件基线由 `11` 收紧为 `8`；
- Adapter 中 `greenfield-*` 文件基线由 `30` 收紧为 `29`；
- 新增 AST 所有权门禁，禁止模型工具顺序重新声明在 Adapter，禁止工具激活策略重新声明在 Composition；
- 更新 Tool Port、Tool Surface、MCP Coordinator 和重写治理 fixture，使其检查稳定真实路径。

本轮没有引入 TypeBox 或 Zod。调整的是同进程内、由 TypeScript 约束的组合参数和策略，没有新增外部 JSON、IPC、配置文件或协议输入；
运行时 Schema 应放在不可信结构化数据的接入边界，而不是为内部组合对象重复静态类型。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本轮 5 个旧 Tool Surface/Policy 模块：删除；
- 受管生产源码与测试中的本轮旧路径、旧类型和旧工厂引用：归零；
- Composition 中 `greenfield-*` 文件：`11 -> 8`；
- Adapter 中 `greenfield-*` 文件：`30 -> 29`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`；
- Composition 公开导出仍为 `18`，没有新增兼容层或改变用户可观察功能。

## 行为兼容性验证

本阶段定向 Tool Surface 行为测试：

```text
8 files passed
32 tests passed
```

架构与迁移门禁为 3 个文件、100 项测试，全部通过。完整 Coding Agent 包验证：

```text
137 files passed, 1 skipped
935 tests passed, 17 skipped
```

根级 `bun run check:quick` 与 `bun run check` 全部通过；完整检查包含根、CLI、Desktop 和 Admin 的独立 TypeScript 检查。
迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=29/29
Composition greenfield files=8/8
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

宿主功能验证结果：

- 独立 `vetta.exe` 编译通过；
- Coding Agent 功能套件通过；
- CLI 功能套件 34 个文件、183 项测试全部通过；
- Desktop 功能套件 119 个文件、501 项测试通过，另 1 项跳过；
- IM `internal/transport/wechat` 整包和原失败用例单独运行均通过；
- `bun run verify:agent-hosts` 两次都在 IM 全量 Go 套件的 `TempDir RemoveAll` 清理阶段失败，错误为测试临时目录仍非空，
  因脚本 fail-fast 未整体返回成功。本轮没有把该无关清理竞态改写成 Tool Surface 变更，也不声明综合宿主门禁通过。

本轮没有发送外部真实模型请求。

## 尚未完成的替换

- Composition 仍有 8 个、Adapter 仍有 29 个 `greenfield-*` 文件，需要继续按职责闭环审计，不能批量改名；
- Composition 剩余文件集中在 Subagent、Turn Capability 和会话持久化编排，下一阶段应处理 Subagent/Turn 完整闭环；
- Desktop 的 `greenfield-runtime` 仍表达迁移阶段，需要单独确认宿主命名、历史格式兼容和生产入口所有权；
- IM 全量 Go 套件的临时目录清理竞态应作为独立测试基础设施问题处理，不与 Coding Agent 架构重写混在一起；
- 后续仍须保持 Tool、Prompt、Skill 和 MCP 在明确刷新边界动态生效，并继续通过 CLI、Desktop、IM、SDK 行为门禁证明功能兼容。

下一阶段优先审计 Composition 中 Subagent Runtime、Child Runtime、Session Assembly、State Persistence 与 Turn Capability Session
Assembly。目标是让 Composition 只保留父子 Session 创建、能力投影和生命周期连接，具体子 Agent 状态与持久化实现归入明确的 Host 或
Session 子域，同时继续保持七个 Subagent 控制工具、父子上下文投影、非递归委派、恢复与通知语义不变。
