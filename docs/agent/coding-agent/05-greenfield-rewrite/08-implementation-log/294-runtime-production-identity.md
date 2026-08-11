# 第 294 轮：Runtime 生产身份收口

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

前序阶段已经让 CLI、Desktop、SDK、RPC 和 IM 使用唯一生产 Runtime，但 `runtime-core/runtime-host` 仍以 `Greenfield*` 导出类型和 `greenfield-*.ts` 模块表示迁移候选身份。该命名会继续暗示存在并行旧架构，并把迁移阶段概念传播到 Coding Agent 和宿主声明中。

本轮将 Kernel 驱动的实现确立为正式生产 Runtime 身份。只调整编译期 API、模块名、文档和诊断标签，不改变运行时行为、持久化格式或跨进程协议值。

## 实施内容

### Runtime Core 生产 API

- 8 个 `runtime-host/greenfield-*.ts` 生产模块按职责重命名为 `runtime-*`、`kernel-*` 或 `conversation-*`；
- 会话门面统一为 `RuntimeSession` / `RuntimeSessionCoreAssembly` / `RuntimeSessionStatus`；
- Kernel 后端统一为 `KernelRuntimeSessionBackend` / `KernelRuntimeAssembly` / `KernelRuntimeFactory`；
- 模型、投影、上下文控制、Document Participant 和组合工厂统一为稳定的 `Runtime*` 或职责名称；
- Kernel 事件映射统一为 `mapKernelEventToSessionEvents`；
- 不提供 `Greenfield*` 类型别名。旧名字属于迁移 API，本轮以明确 Breaking Change 完成收口。

### 调用方与测试

- Coding Agent、CLI、Desktop 和 Runtime Storage 的全部类型调用方切换到新生产 API；
- Runtime Core 的 7 个相关测试文件、Runtime Storage 投影测试以及 Coding Agent 的 Turn Executor、Extension Action Host、Active Session Host 测试改为职责命名；
- Runtime Core README 改为描述已经投入生产的 Kernel-backed Runtime，不再描述并行候选后端；
- Runtime Core Changelog 在 `[Unreleased]` 下记录公开 API Breaking Change。

### 保留的运行时协议

以下值是现有可观察协议或历史数据合同，本轮明确不改：

- CLI Runtime Host 的 `kind: "greenfield"` 与 `kind: "greenfield-print"`；
- RPC Session Profile 的 `"greenfield"` / `"greenfield-im"`；
- 历史会话迁移结果中的 `kind: "greenfield"`；
- Conversation JSONL、SessionEvent、RPC/IM frame、错误、取消、事件顺序和资源关闭语义。

### 类型校验判断

本轮没有新增外部不可信结构化输入，也没有改变 JSON、RPC、Provider 或 Tool Schema。工作仅涉及静态 TypeScript API 和模块路径，因此无需引入 TypeBox 或 Zod。

## 防回退门禁

`check-coding-agent-migration-residue.mjs` 新增两项零基线：

- `runtimeCoreMigrationFiles=0`：`runtime-core/src` 不得重新出现 `greenfield-*.ts` 生产文件；
- `productRuntimeMigrationIdentities=0`：Runtime Core、Runtime Storage、Coding Agent、CLI 和 Desktop 生产源码不得重新引用 `GreenfieldRuntime*`、`GreenfieldSession*`、`GreenfieldDocument*`、`ComposedGreenfieldRuntime*` 或 `mapGreenfieldKernel*`。

门禁测试新增 Runtime Core 旧文件名与跨包旧类型引用负例，并更新已有迁移负例以验证新旧门禁可同时报告。

## 旧实现依赖变化

- Runtime Core `greenfield-*.ts` 生产模块：`8 -> 0`；
- 产品生产源码中的 Runtime 迁移类型标识符：`75` 个文件涉及的引用全部收口为 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 旧执行入口：保持 `0`；
- 运行时协议值变化：`0`；
- 用户可见功能变化：`0`。

## 行为兼容性验证

- Runtime Core 定向测试：7 个文件、30 项通过；
- Coding Agent 全量测试：137 个文件、935 项通过，另有 1 个文件、17 项按既有条件跳过；
- CLI Runtime/RPC/Todo/Hook 定向测试：3 个文件、20 项通过；
- Runtime Storage 投影测试：1 个文件、3 项通过；
- 迁移残留门禁测试：25 项通过；
- `bun run check:quick` 通过，新增两项残留指标均为 `0/0`；
- 根级 `bun run check` 通过：Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫通过；
- 本轮未发送外部真实模型请求；模型、工具、持久化与宿主行为由现有本地合同和集成测试验证。

## 尚未完成的替换

- Coding Agent 测试目录仍有少量 `greenfield-*.test.ts` 历史命名；它们不进入生产源码，但后续应按实际职责重命名，并区分历史格式 fixture 与生产行为合同；
- 生产日志、错误文案和历史注释中仍有不属于 TypeScript API 的 `Greenfield` 迁移措辞；后续应分类清理，不能误删公开 wire discriminant 或历史数据说明；
- `greenfield` 运行时判别值仍是现有跨进程兼容合同。若要改名，必须作为独立协议版本化阶段处理，不能用内部字符串替换完成。
