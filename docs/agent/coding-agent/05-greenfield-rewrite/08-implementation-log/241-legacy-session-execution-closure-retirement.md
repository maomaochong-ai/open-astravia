# 第 241 阶段：旧 Session 执行闭包退役

## 阶段目标

在不改变 CLI、SDK、RPC、Extension、工具、资源和旧会话数据行为的前提下，完整删除旧 `AgentSession`、旧 `SessionManager`、旧 SDK/RPC 适配器及仅服务于该执行闭包的控制器，并让稳定 SDK 与 capability-based RPC 成为唯一会话执行入口。

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

第 240 阶段已经把 Session 值合同、纯投影和旧 JSONL 格式边界从具体 Manager 中分离。本阶段据此拆除最后的旧会话执行闭包，避免继续为已无生产消费者的旧类维护两套执行语义。删除的是旧结构和兼容入口，不是产品功能；活动会话、动态 Tool、资源刷新、Extension、RPC 和旧数据读取继续走 Greenfield 组合。

## 实施内容

### 1. 删除旧执行对象和控制器

- 删除旧 `core/agent-session.ts`、`core/sdk.ts` 与完整 `core/session-manager` 目录。
- 删除只被旧 `AgentSession` 组合的输入、事件、队列、模型、压缩、重试、Bash、后台任务、Todo、Subagent、会话导航和 identity transition 控制器。
- 删除旧 Subagent child factory、旧 SDK storage/subagent adapter、旧 RPC Session adapter 与 SDK compatibility inventory。

### 2. 收窄公开入口与 Host 组合

- 包根不再导出旧会话对象、旧工厂、旧 RPC 入口和 Subagent 内部实现。
- SDK Host Adapter 直接消费稳定 `CreateCodingAgentSessionOptions` 和宿主上下文，不再接受旧 Manager、ResourceLoader 或旧 child factory 注入。
- RPC 统计合同改为稳定 `CodingAgentSessionStats`；RPC 只保留 capability-based 执行入口。
- CLI HTML 导出直接使用独立 Legacy Session 文档 Reader，继续支持旧 JSONL，但不会实例化旧 Manager。

### 3. 行为测试迁移

- 保留 Compaction 算法与大会话 fixture，改用新 Session 投影及独立 Legacy 文档解析器。
- Extension Runner 测试改用结构化 `ExtensionSessionView` fixture；不再借旧 Manager 充当只读上下文。
- `md_intro` Schema 注入/剥离能力归入 Greenfield Plugin Tool Runtime，并保留原测试。
- 删除直接构造旧类、访问私有控制器或断言旧目录结构的测试；对应的活动 Session、并发、压缩、资源释放、RPC、SDK 与 Extension 行为由现有 Greenfield 测试继续覆盖。

### 4. 防回流治理

- 重写进度基线新增显式 `--write-baseline`，使每次机械更新可审计、可复现。
- Legacy execution 守卫登记旧 `AgentSession`、旧 SDK 和 `session-manager` 目录为禁止恢复目标。
- 新增测试导入检查，拒绝任何测试重新依赖已退役的旧 Session 实现；字符串 fixture 不会被误判为真实 import。

## 行为兼容性验证

- 17 个 Coding Agent 定向测试文件通过 129 项，2 项外部 LLM 凭证测试按既有条件跳过。
- SDK Host 覆盖模型选择、内置 Tool 激活、动态自定义 Tool、Tracing、Subagent 缺省策略、产品 capability 与活动 Session 切换。
- RPC 覆盖 16 项命令分发；Extension、资源、Compaction、Session 投影、锁和 Plugin Tool 测试继续通过。
- 两个治理测试文件共 20 项通过，覆盖旧源码恢复、测试导入回流、公开 SDK 和产品 Core 边界。
- 补充迁移后的公共入口、Subagent 和 Runtime Storage 定向测试共 17 项通过。
- `bun run check:quick` 与完整 `bun run check` 均通过；完整检查覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 旧实现依赖变化

| 指标 | 第 240 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 83 | 69 | 0 |
| `agent-session` / `sdk` / `session-manager` 旧执行依赖边 | 8 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 143 | 107 | 0 |
| Legacy 格式边界到旧实现的依赖边 | 0 | 0 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 全仓仍有 69 条旧产品 Core 依赖和 107 个旧实现文件；本阶段只完成 Session 执行闭包退役，不把其它领域混入同一阶段。
- 剩余最大依赖域是 Session 产品策略、ModelRegistry、Bash、MCP、Agent Mode、Auth、Export HTML、Memory 与 Subagent；它们需要按独立能力域逐一迁移，不能重新集中到新的大文件或 Manager。
- 包根仍聚合部分旧 Core 值能力。下一阶段应先审计真实外部消费者，再把稳定合同移动到对应领域入口，并删除无消费者的聚合导出。
