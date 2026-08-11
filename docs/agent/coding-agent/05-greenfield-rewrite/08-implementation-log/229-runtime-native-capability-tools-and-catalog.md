# 第 229 阶段：Runtime 原生能力 Tool 与 Catalog 边界

## 阶段目标

把仍由旧 Tool 工厂持有的会话能力工具迁入 `runtime-tools`，使 `coding-agent` 只注入宿主能力、状态与产品激活策略；同时让 CLI 和稳定 SDK 的内置工具名称不再依赖旧 `core/tools`。本阶段只重构架构，不改变工具名称、描述、Schema、scope、输出、错误或运行时动态变化语义。

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

`ask_user_question`、`invoke_skill`、`memory`、`todo`、`tool_search` 和知识标签查询都属于可组合的 Tool 能力，不属于 Agent 内核。它们的 TypeBox Schema、TS 描述、Registration 与执行协议现在由 `runtime-tools` 持有；`coding-agent` 只提供问答宿主、Skill 内容、Memory/Todo 状态、知识查询和产品激活名称。旧实现仅在差分测试中作为行为 Oracle，不被新生产代码调用。

工具继续集中在 `runtime-tools/src/coding/tools/<tool-name>/`，没有回收到 `coding-agent`。`coding-agent` 新增的文件只承担产品 Composition 或窄 Operations Adapter，符合 Tool 域与产品域的边界。

## 实施内容

- 在 `runtime-tools` 新增 7 组独立 Tool 模块：问答、Skill 调用、动态 Tool 搜索、Memory、Todo、知识标签枚举与知识标签过滤；每组分别持有描述、Tool、Registration 和导出入口。
- 用 Operations/Store/Capability Port 注入宿主状态和副作用，Runtime Tool 不依赖 `coding-agent`。
- Greenfield 问答、Skill、MCP 延迟搜索、Memory rollover、Todo 和知识 Tool Surface 切换到原生 Registration。
- CLI 与稳定 SDK 改用产品级内置工具名称集合，仅表达默认激活策略；动态注册 Tool 与 MCP Tool 仍由运行时 Catalog 决定，不被封闭枚举限制。
- 删除没有生产调用方的旧 Bash/Shell `CommandExecutor` Adapter，避免为旧 Tool 实现保留无意义的兼容边界。
- 知识查询暂由 `coding-agent` 的窄 Operations Adapter 调用旧知识查询实现；该依赖被明确计入 Knowledge 域基线，未伪装成已完成迁移。

## 旧实现依赖变化

| 指标 | 第 228 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 197 | 187 | 0 |
| Tool 域旧依赖 | 17 | 6 | 0 |
| Knowledge 域旧依赖 | 5 | 6 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 182 | 182 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

本阶段从 Tool 域删除 11 条旧依赖：5 个能力 Tool 工厂、2 个知识 Tool 工厂、Bash/Shell 两条执行依赖，以及 CLI/SDK 两条旧 Catalog 依赖。知识 Tool 的查询能力改为显式 Operations Adapter 后新增 1 条 Knowledge 域旧依赖，因此总依赖净减少 10 条，而不是用跨域漏计得到 11 条。

Tool 域剩余 6 条依赖由包根旧 Tool 导出与 RPC `ImHostBridge` 构成；它们尚未迁移，不能宣称 Tool 域已经归零。

## 行为兼容性验证

- 新增 7 项旧新差分测试，逐项比较工具定义、Registration 元数据、成功输出、错误文本和状态变化；旧实现只作为测试 Oracle。
- Runtime Tools Catalog、动态激活、Feature 与产品 Tool 合同共 46 项测试通过。
- Coding Agent Greenfield 问答/Skill、Memory、Todo、产品 Tool Surface、CLI 参数与稳定 SDK 共 68 项测试通过。
- Monorepo `tsgo --noEmit`、`bun run check:quick` 与完整 `bun run check` 均已通过；Biome、根/CLI/Desktop/Admin 类型检查及全部质量守卫无错误。

## 尚未完成的替换

- 仍有 187 条生产代码到旧实现的精确依赖，目标为零。
- Tool 域剩余 6 条旧依赖，需要迁移包根旧导出消费者与 RPC Host Bridge，不能把工具实现搬回 `coding-agent`。
- Knowledge 域当前为 6 条旧依赖，其中本阶段显式 Adapter 仍调用旧查询实现；后续应在独立知识能力包建立查询合同和存储实现，再移除该 Adapter 的旧依赖。
- 旧实现文件仍为 182 个；必须先建立独立生产替代与行为合同，再删除对应实现。
- 唯一旧 SDK 示例、8 个旧格式边界及其中 3 条旧实现依赖尚未归零。
