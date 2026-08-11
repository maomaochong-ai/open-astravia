# 第 244 阶段：模型运行时领域重写

## 阶段目标

在不改变内置模型、自定义 Provider、远程模型、认证、模型筛选和默认模型选择行为的前提下，删除旧 `core/model-registry.ts`、`core/model-resolver.ts`、`core/defaults.ts` 与 `core/resolve-config-value.ts`，由独立模型领域承担配置、远程来源、动态目录、凭证解析和选择策略；Coding Agent 组合根只注入窄模型运行时合同。

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

第 243 阶段完成 Subagent Tool 领域闭环后，Model Registry 是剩余旧领域中同时影响 CLI、SDK、Desktop 和知识加工的主要共享状态。旧实现把文件配置解析、环境变量展开、内置模型、自定义 Provider、远程下载、Token、OAuth、模型查询和选择策略集中在一个 Registry 中。本阶段按稳定职责拆开这些能力，并删除旧实现，不保留旧类、旧深层入口或兼容包装。

## 实施内容

### 1. 建立模型领域合同与动态运行时

- 新增 `src/models/model-contracts.ts`，分别定义目录读取、凭证存储、远程来源和完整模型运行时合同。
- `model-runtime.ts` 只组合内置模型、本地配置、远程来源与凭证；模型、Token 和 Provider 在运行期间仍可动态变化，不生成跨 Turn 的冻结快照。
- Runtime Core 适配器只依赖 `CodingAgentRuntimeModelSource`，共享宿主控制器只依赖设置 Token 和刷新远端模型两个操作。

### 2. 拆分配置、远程来源与选择策略

- `configuration/` 独立承担环境变量、命令替换和 Header 解析，Desktop 不再导入旧 `core/resolve-config-value` 深层入口。
- `models/configuration/` 分离 TypeBox Schema、本地 `models.json` 读取和模型合并规则；坏 Provider 单独报告，不能使其它有效 Provider 一起失效。
- `models/remote/` 隔离 HTTP、超时、状态码与响应解析，并允许注入 Fetch 与 Token Getter 进行确定性验证。
- `models/selection/` 分离 Pattern、Scope、默认值和初始模型选择，不再由 Registry 同时承担策略与状态。

### 3. 保留动态行为和用户数据语义

- 保留无 Key 本地 Provider、OAuth、自定义 Header、远程模型标记、Provider 注册、模型覆盖、包含/排除 Pattern、默认模型回退和 API Key 缓存行为。
- 远程刷新并发去重；每次请求读取最新 Token Getter，401 映射为 `unauthorized`，HTTP 或 Schema 失败不污染已有可用模型且允许后续重试。
- TypeBox 只用于外部 JSON 边界校验；内部运行时保持显式 TypeScript 合同，不增加重复 Schema 层。

### 4. 删除旧实现并迁移调用方

- 删除四个旧 Core 文件、两个旧 Runtime Adapter，以及蓝屏恢复过程中产生但不符合重写目标的临时兼容文件。
- 包根和 Host Services 不再导出 `ModelRegistry`；新增 `configuration` 子路径和 `createCodingAgentModelRuntime` 工厂。
- CLI、SDK、Desktop、知识加工、Runtime Core 适配器、示例和有效行为测试改为依赖新合同。
- 审查脚本将两个旧 Adapter 和临时兼容文件登记为旧实现路径；这些路径重新出现会导致精确基线失败。

## 行为兼容性验证

- monorepo `tsgo --noEmit` 通过。
- desktop-app 独立 `tsc --noEmit` 通过。
- `bun run check:quick` 通过；Biome 和全部质量守卫通过。
- `bun run check` 中 lint、根级类型、CLI、desktop-app 与守卫通过，最后仅 admin `tsc -b` 因蓝屏后 `packages/admin/node_modules/@types/*` 文件 ACL 拒绝读取而失败；尝试 `bun install --force` 也因当前沙箱临时目录 ACL 报 `AccessDenied`，未改动依赖或锁文件。
- 新增远程模型运行时测试，覆盖缺少 URL/Token、并发去重、实时 Token、响应映射、401、HTTP/Schema 失败和失败后重试。
- 原模型目录与模型选择行为测试已迁移到新运行时，并使用确定性内置模型 fixture。
- 当前 Windows/Bun 测试执行器在收集测试前失败：fork 池报 `File URL path must be an absolute path`，thread/vmThread 池报 `port.addListener is not a function`；没有测试用例被执行，因此不能把这次 Vitest 尝试记为通过。

## 旧实现依赖变化

| 指标 | 第 243 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 45 | 33 | 0 |
| Model Registry / Resolver / Defaults / Config Value 旧依赖边 | 12 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 82 | 78 | 0 |
| 本阶段四个旧 Core 实现文件 | 4 | 0 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 仍有 33 条旧产品 Core 依赖和 78 个旧实现文件；剩余较大的领域是 Bash Executor、MCP、Auth Storage、Export HTML 和 Memory。
- `modelRegistry` 仍作为部分 Extension 公共上下文字段和组合调用参数名称存在，但其值已经是新的窄模型运行时合同，不再引用旧 Registry 实现；公共 Extension 字段是否更名必须作为独立协议变更评估，不能在架构迁移中静默破坏插件。
- 本阶段测试执行器故障需要在环境恢复后重新运行模型领域定向测试；类型检查和质量守卫不能替代行为测试结果。
