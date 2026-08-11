# 第 259 阶段：CLI Runtime Host 职责拆分

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

第 258 阶段已经将进程级 Session Host 所有权收回 `coding-agent`，但 CLI 的 `greenfield-im-runtime-host.ts` 仍以 670 行单文件同时承担启动决策、会话装配、RPC capability、Print 连接、公共合同和资源回滚。职责虽然都属于 CLI 宿主层，但混在一个模块中会让协议变化、会话装配和资源生命周期相互影响。

本阶段按真实所有权拆成四个模块：稳定宿主合同、CLI Session 装配、RPC capability 连接和薄的启动编排入口。`coding-agent` 继续拥有产品组合和进程 Session Host；CLI 只负责参数映射、协议选择和宿主连接，没有把 Tool、MCP 或 Session 实现重新搬回 CLI。

## 实施内容

- 新建 `rpc/runtime-host/greenfield-runtime-host-contract.ts`，集中定义 RPC、IM、Print 宿主准备结果与启动参数，不再保留重复的 IM 类型别名。
- 新建 `greenfield-cli-session-assembly.ts`，只装配 MCP 来源、Coding Agent Composition、活动 Session、Extension、命令动作和 `CodingAgentProcessSessionHost`，并保持原来的初始化回滚与释放顺序。
- 新建 `greenfield-rpc-runtime-capabilities.ts`，只连接 Bash、通用 RPC/IM Adapter 与 Session Host，并继续拥有订阅、初始化和分阶段释放语义。
- 新建 `greenfield-runtime-host.ts` 作为唯一实现入口，保留迁移判断、模型解析、RPC/IM/Print 启动和不兼容结果映射。
- 删除 670 行的旧聚合实现 `rpc/greenfield-im-runtime-host.ts` 和纯转发文件 `rpc/greenfield-rpc-runtime-host.ts`；调用方直接引用唯一入口。
- `cli-app` 包根只将原有 IM 公共函数切换到新入口，并用 RPC 命名的通用合同替代旧 IM 类型别名；没有额外公开内部 RPC/Print 启动函数。
- 未引入 TypeBox 或 Zod：本阶段没有新增外部数据格式或运行时反序列化边界，现有静态联合类型足以表达宿主结果。

## 旧实现依赖变化

- 旧 CLI Runtime Host 文件：`2 -> 0`。
- `GreenfieldImRuntimeHost*`、`GreenfieldImFallbackReason`、`PrepareGreenfieldImRuntimeHostOptions` 和 `PrepareGreenfieldRpcRuntimeHostOptions` 等废弃别名引用：`0`。
- 唯一 Runtime Host 入口直接创建 Session Host、MCP 来源或 RPC Adapter/capability 实现的引用：`0`。
- CLI Session 装配模块依赖 RPC、IM、Print 协议 capability 的引用：`0`。
- Coding Agent 旧实现文件、旧实现依赖、Runtime 反向依赖、compat 导出和旧执行入口继续保持 `0`。

重写进度守卫升级到 version 9，以上四类边界均为不可通过 baseline 合法化的零目标。守卫测试同时覆盖旧文件恢复、旧别名恢复、入口重新接管资源和 Session 装配反向依赖协议层四种回退。

## 行为兼容性验证

- `cli-app` 独立类型检查通过。
- Runtime Host、IM RPC Adapter 与两类不兼容策略定向测试：4 个文件、36 个测试通过。
- 重写治理测试：1 个文件、17 个测试通过。
- `packages/cli-app` 全包测试：35 个文件、194 个测试全部通过。
- 全包测试覆盖旧会话迁移与恢复、初始化失败清理、Extension/Hook/MCP 生命周期、Print/RPC/IM、安装后独立可执行产物、动态 Skill/MCP 更新和进程重启。
- `bun run check:quick` 通过，新增架构守卫实际扫描结果均为 `0/0`。

## 尚未完成的替换

- `@vetta/coding-agent/composition` 的公开表面仍较宽，需要按真实外部消费者区分稳定合同和仅供产品宿主装配的入口，但不能重新增加 CLI 转发层。
- CLI Runtime Host 的唯一入口仍负责迁移决策、模型解析和三种协议启动；这些属于同一启动编排流程，暂不继续机械拆分。后续只有在消费者或测试证明存在独立变化原因时再提取。
- 下一阶段应审计 `@vetta/coding-agent/composition` 的导出与实际消费者，收窄可见性并补“内部组合实现不得被宿主深层依赖”的守卫，同时保持现有 CLI 194 项行为基线不变。
