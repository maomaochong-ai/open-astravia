# 第 249 阶段：Memory 领域完整重写

## 阶段目标

在不改变 memory-mode 门控、冻结快照、Memory Tool、自动/显式 flush、JOURNAL、约 70% rollover 阈值和 conversation continuation 行为的前提下，删除旧 `src/core/memory`、旧 Memory Tool 工厂和位于 Runtime 适配层的 Memory 编排实现，建立独立 Memory 领域及其可替换合同。

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

- Memory 不再属于 Agent 内核或 Runtime 适配器内部实现，而是 `coding-agent/src/memory` 下通过明确合同组合的产品能力。
- `runtime-tools` 继续独立拥有 Memory Tool 的 TypeBox 输入合同、描述和运行时 Tool 实现；`coding-agent` 只注入文件操作 Port，没有把工具代码复制回产品包。
- Memory 纯文本格式无需 TypeBox/Zod：外部 Tool 输入已经由 TypeBox 校验，MEMORY.md 与 JOURNAL.md 是受明确分隔符和行协议约束的文本持久化格式。

## 本阶段实施内容

### 1. 分离存储与条目代数

- `memory-document.ts` 只负责条目解析、序列化、add/replace/remove、首个 substring 匹配、精确错误和 4000 字符默认预算。
- `FileMemoryStore` 实现稳定路径读取、缺失/不可读返回空字符串和 temp+rename 原子写；运行时依赖 `MemoryStore` 合同。

### 2. 分离 flush 抽取与写入策略

- `AiMemoryFactExtractor` 只负责消息轻量序列化、既有提示词、`completeSimple(maxTokens=1024)` 调用和 `NONE`/`- ` 行协议解析。
- `MemoryFlushService` 只负责双向 contains 去重、逐条写入、预算失败停止和整体 best-effort；抽取器与存储均可独立替换。

### 3. 分离 JOURNAL 与 Session 编排

- `FileMemoryJournal` 独立实现本地日期/时间、完成 Turn 行、工具文件路径收集、rollover 段、截断和 best-effort。
- `CodingAgentMemoryRolloverOrchestrator` 移入 Memory 领域，继续冻结 Session 级 prompt 快照、提供约 70% 压缩策略、观察完成 Turn、执行 rollover 前 flush/journal，并只向 Runtime Core 返回通用 continuation directive。
- `greenfield-memory-controller` 保留为宿主按需 flush 适配器；Context Runtime 只依赖 `CodingAgentMemoryCompactionPolicy`。

### 4. 删除旧实现与结构性 Oracle

- 删除旧 `src/core/memory/{memory-store,memory-flush,memory-journal}.ts`。
- 删除旧 `src/core/tools/memory` 工具工厂和文本描述；工具能力继续由 `runtime-tools/src/coding/tools/memory` 提供。
- 删除旧 `greenfield-memory-rollover-orchestrator.ts`；既有稳定 Runtime Host 子路径直接转出新 Memory 领域合同，不保留旧实现包装器。
- `runtime-tools` 的工具兼容测试改为验证明确稳定合同和纯内存操作 Port，不再导入旧 coding-agent Memory 实现作为 Oracle。

### 5. 建立零回流守卫

- 重写守卫升级到 version 4，新增 `Legacy Memory references` 硬指标。
- 生产源码和 coding-agent/runtime-tools 测试中的 `core/memory/`、`core/tools/memory/` 与旧 rollover 适配器路径一旦出现，即使写入基线也会失败。
- 治理单测验证旧存储路径和旧适配器路径均不可回流。

## 行为兼容性验证

- 新增 Memory 单元测试 9 项：覆盖分隔符与首匹配、精确校验/预算错误不落盘、缺失文件与原子写、消息序列化与抽取协议、去重与预算停止、flush best-effort、Turn JOURNAL、rollover 截断和不可写路径 best-effort。
- 既有 Memory rollover 与 Context 集成测试 7 项通过，覆盖冻结快照、70% 阈值、失败容错、事件观察、Tool feature、自动 rollover 与手动压缩隔离。
- `runtime-tools` capability Tool 合同测试 7 项通过；Memory Tool 的名称、描述、TypeBox schema、scope、category、返回文本和 details 保持不变。
- 重写治理测试 12 项通过；定向 TSGo 类型检查通过；`bun run check:quick` 通过。

## 旧实现依赖变化

| 指标 | 第 248 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 15 | 11 | 0 |
| Memory 旧依赖边 | 4 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 54 | 50 | 0 |
| Memory 旧 TypeScript 实现文件 | 4 | 0 | 0 |
| Legacy Memory 路径/旧适配器引用 | 未独立统计 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 仍有 11 条旧产品 Core 依赖和 50 个旧实现文件。
- Hooks、Slash Commands 和 Timings 各有 2 条旧依赖；Background Tasks、Concurrency、Event Bus、Footer Data Provider 与 Image Budget 各有 1 条。
- 下一阶段宜把剩余的横切运行时基础设施作为一个完整阶段处理：先冻结 Hook Tool wrapping、计时、事件/并发和图像预算行为，再按独立合同归位，避免把每个单文件拆成无意义的小阶段。
