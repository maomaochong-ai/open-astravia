# 第 233 阶段：Coding Agent Compaction 包内领域重写

## 阶段目标

在 `coding-agent` 包内建立独立 `compaction` 领域目录，替代旧 `core/compaction`。Compaction 属于 Coding Agent 的产品上下文策略，不新建 Runtime 包；Runtime Core 继续只负责 Context 状态与提交事务，Runtime Storage 继续只负责持久化。本阶段仅调整职责、合同和依赖方向，不修改阈值、切点、摘要、prefire、microcompact、熔断、分支汇总或用户可见行为。

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

Compaction 是围绕最小 Agent 内核组合的产品能力：它决定何时压缩、保留多少上下文、如何生成可继续工作的摘要以及如何处理分支。它不应属于通用 Runtime Kernel，也不应直接持有会话文件或 Conversation Document。包内领域目录保留 Coding Agent 的产品职责，同时用中立合同切断旧 SessionManager 与新 Runtime 存储实现对算法的控制。

本阶段没有创建新的 workspace 包，也没有引入 Compaction Manager。旧 SessionEntry 与 Greenfield Conversation 只需满足同一结构合同；分支遍历只消费 `getBranch`/`getEntry` 最小只读端口，算法不感知数据来自 JSONL、内存还是 Runtime Storage。

## 实施内容

- 新增 `src/compaction/contracts.ts`，定义压缩历史条目、压缩结果、设置和泛型分支读取端口。
- 新增 `token-policy.ts`，独立持有 context usage、阈值与字符估算策略；策略没有 Session 或 Runtime 依赖。
- 迁移并保留 `compaction.ts`、`branch-summary.ts`、`microcompact.ts`、`prefire.ts`、`circuit-breaker.ts` 与摘要支持实现。
- `prepareCompaction`、cut-point、prefire fingerprint 和 branch summary 改为消费只读中立历史合同；Legacy SessionManager 通过 TypeScript 结构类型直接满足合同，Greenfield 继续从 Conversation Document 投影历史。
- 所有 Core、Greenfield Adapter、RPC、包根导出和测试调用方切换到 `src/compaction`，包根原有 API 名称继续导出以保持功能兼容。
- 删除 `src/core/compaction` 的 7 个旧文件，不保留转发文件或兼容执行入口。
- 增加质量守卫，禁止恢复旧目录/旧导入，并禁止新 Compaction 领域依赖 `core`、Adapter、Runtime Core 或 Runtime Storage 具体实现。

## 旧实现依赖变化

| 指标 | 第 232 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 156 | 148 | 0 |
| Compaction 域旧依赖 | 8 | 0 | 0 |
| Tool 域旧依赖 | 0 | 0 | 0 |
| Knowledge 域旧依赖 | 0 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 163 | 156 | 0 |
| 旧 SDK 示例 | 0 | 0 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

Compaction 的 8 条旧生产依赖和 7 个旧文件已经全部删除。新领域只依赖 `@vetta/agent-core`、`@vetta/ai`、包内 Model Context 与自身合同，没有 SessionManager、SettingsManager、AgentSession、RPC/Desktop 或 Runtime Storage 反向依赖。

## 行为兼容性验证

- 迁移前 7 个定向测试文件、49 项测试通过（另 2 项既有跳过），建立阈值、切点、prefire、自动压缩和 Greenfield Memory 行为基线。
- 迁移后 8 个定向测试文件共 68 项测试通过（另 2 项既有跳过），覆盖 Compaction、prefire、自动压缩、Session identity、Greenfield Extension/Context/Memory。
- 2 个质量治理测试文件共 61 项测试通过；新增守卫覆盖旧目录恢复、旧导入恢复、SessionManager 回流和 Runtime Conversation 回流。
- 根 `tsgo --noEmit`、`bun run check:quick` 与完整 `bun run check` 均通过；Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫无错误。

## 尚未完成的替换

- 仍有 148 条生产代码到旧实现的精确依赖，目标为零；当前高依赖域为 Extensions 26、Session 17、Session Manager 14、Resource Loader 9、Settings Manager 9 和 Model Registry 8。
- 旧 AgentSession、SessionManager 与 Extension Runner 仍消费新的 Compaction 领域以保持兼容行为，它们自身仍是待退役执行岛。
- 8 个旧格式边界及其中 3 条旧实现依赖仍需独立审计；旧数据读取不能重新进入 Compaction 算法。
- 下一阶段应优先审计 Extensions 26 条依赖的职责分组和替代闭环，避免把 Extension Runner 整体移动到新目录；也可先处理 Resource Loader/Settings 的稳定输入合同，但不应再次修改已冻结的 Compaction 行为。
