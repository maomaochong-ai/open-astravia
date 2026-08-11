# 第 287 轮：产品能力领域归位与 Adapter 迁移身份清零

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

第 286 轮留下的 8 个 `greenfield-*` Adapter 并不是同一种边界。本轮逐个按真实职责判断所有权，不把它们批量搬到另一个兼容目录：

| 能力 | 正式所有权 | 处理 |
| --- | --- | --- |
| Ask User Question | `composition/tool-surface` | 保留产品 Tool Feature，改用稳定身份 |
| Invoke Skill | `resources/skills` | 保留动态 Skill 调用能力，归入 Skill 域 |
| Product Tools | `composition/tool-surface` | 只保留产品激活和宿主端口装配；工具实现仍在 `runtime-tools` |
| Sandbox Tools | `host/session-execution` | 保留 OS 沙箱宿主装配 |
| Subagent Tools | `composition/subagent` | 保留 Subagent 工具注册编排 |
| Todo | `work-state` | 状态运行时与 Tool Feature 分文件，合同归入 Work State 域 |
| Memory | `memory` | Session Memory Controller 归入 Memory 域 |
| MCP Deferred | `runtime-mcp` | 删除 Coding Agent 内无调用者的重复实现，继续使用正式 `runtime-mcp` 控制器和检索工具 |

这不是功能重写：工具名称、参数、激活策略、执行宿主、动态资源读取、持久化和生命周期语义均保持不变。

## 实施内容

### 产品能力归位

- Session Peripheral Assembly 直接组合 Ask User Question、Product Tool 和 Todo 正式模块；
- Turn Capability Assembly 直接组合 Skill 域的 Invoke Skill Feature；
- Session Context 与 Lifecycle 直接依赖 Memory 域合同；
- Session Execution Runtime 只从自身宿主域获取 Sandbox Tool Registrations；
- Subagent Runtime 只从 `composition/subagent` 获取其 Tool Registrations；
- Todo 的进程内合同从通用 `runtime-contracts` 移入 `work-state/contracts.ts`，避免通用合同目录了解具体状态实现。

### 删除重复 MCP Deferred 实现

旧 `greenfield-mcp-deferred-adapter.ts` 的生产调用者为零，并重复实现了 `@vetta/runtime-mcp` 已提供的 Deferred Controller、Tool Search 和提示词行为。本轮直接删除该文件，没有保留转发、别名或兼容包装；现有 MCP Session Coordinator 继续使用正式 `McpDeferredToolController`。

### 类型校验判断

本轮只调整进程内 TypeScript 合同、模块所有权和 Composition Wiring，没有新增外部不可信结构化输入。既有 Tool Schema 和 MCP 输入校验继续由对应 Runtime 包承担，因此没有额外引入 TypeBox 或 Zod。

### 防回退门禁

- Adapter `greenfield-*` 基线由 `8` 收紧为 `0`；
- 8 个旧路径和对应旧符号加入永久退休清单；
- 已知退休路径由精确错误报告，未知的新 `greenfield-*` Adapter 由零基线拦截；
- Runtime Port 所有权门禁改为验证 `work-state/todo-runtime.ts` 显式实现 Todo 合同；
- Package Boundary 门禁新增 Memory 产品域，并使用本轮稳定的 Product Tool、Memory 和 Skill 身份检查 Composition 事务边界；
- 新增 fixture 验证 MCP Deferred 和 Product Tool 旧 Adapter 身份无法回归。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本轮退役的迁移期 Adapter 文件：`8`；
- Adapter 中 `greenfield-*` 文件：`8 -> 0`；
- Composition 中 `greenfield-*` 文件：保持 `0`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`；
- `packages/coding-agent/src` 中仍带 `greenfield` 文件名的文件：`1`，仅剩 RPC 能力模块。

迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=0/0
Composition greenfield files=0/0
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

## 行为兼容性验证

- 本轮定向质量门禁：3 个文件、85 项测试通过；
- 本轮受影响功能定向测试：9 个文件、20 项测试通过；
- Coding Agent 全量：137 个文件通过、1 个文件跳过，935 项通过、17 项跳过；
- 根级 `bun run check:quick` 通过；
- 根级 `bun run check` 通过，覆盖 Root、CLI、Desktop、Admin 类型检查、Biome 和全部质量门禁；
- `bun run verify:agent-hosts` 通过：独立 `vetta.exe`、IM Gateway、Coding Agent、CLI、Desktop 全部通过；
- Desktop 功能套件为 119 个文件、501 项通过，另 1 项跳过。

首次门禁测试发现零基线会对已知退休 Adapter 同时输出精确路径错误和通用数量错误。随后将通用计数限定为未列入退休清单的新残留：已知路径仍由精确规则拒绝，未知路径仍由零基线拒绝。首次快速检查只发现导入顺序和格式问题，格式化后通过。本轮没有发送外部真实模型请求。

## 尚未完成的替换

- Coding Agent 源码中仍有一个迁移期文件名：`modes/rpc/greenfield-rpc-capabilities.ts`，需判断其是稳定 RPC 产品能力还是仍含迁移策略；
- SDK Session Host、公开 API 和测试中仍有部分 `CodingAgentGreenfield*` 身份，需要区分产品协议、上游 `runtime-core` 合同和可退休迁移命名，不能批量替换；
- `adapters` 目录仍保留真实协议、模型、Extension 和 OS 边界；后续应按“是否转换外部合同”逐个审计，而不是以目录清零为目标；
- 历史 Session 格式读取和迁移仍是必须保留的数据兼容边界，不属于旧执行架构。

下一阶段应先审计唯一剩余的 `greenfield` 源文件及其 RPC 调用者，再审计 SDK Host 中的迁移身份和真实协议边界。完成标准是稳定生产命名与职责一致、旧执行入口和反向依赖继续为零、CLI/Desktop/IM 行为基线不变。
