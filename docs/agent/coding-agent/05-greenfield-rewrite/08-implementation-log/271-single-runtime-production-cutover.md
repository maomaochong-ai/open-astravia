# 第 271 阶段：单 Runtime 生产切换

本阶段把 CLI、Desktop、IM 从迁移期的“双 Runtime 选择与回退”状态切换为单一生产 Runtime。旧功能语义和历史数据兼容继续保留，但旧架构不再是可执行后端，也不再通过参数、环境变量、RPC 字段或宿主决策对象参与生产运行。

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

迁移期允许 Legacy/Greenfield 并存，是为了逐项证明新架构保持旧行为；生产期继续保留这种选择会使旧架构永久成为运行时依赖。本阶段因此删除“选哪个 Runtime”的控制面，只保留“以哪种产品模式运行”的正常入口路由。

边界现在是：

1. CLI 根据 control、print、RPC 和 IM host 意图进入同一个生产 Session Host。
2. Desktop 的普通会话、知识加工和 Runtime canary 使用同一个生产 Runtime pool。
3. IM Gateway 只负责协议和子进程生命周期，不再协商 Runtime 后端。
4. 旧 JSONL 会话在打开生产 Session 前经独立 historical import 转换；源文件保持只读，转换失败显式报错，不回退执行旧 Session。

## 实施内容

### CLI 与 RPC

- 删除 `--agent-runtime`、运行时选择结果、requested/effective backend 和 fallback reason。
- RPC startup failure、Host capability 和 CLI 错误输出不再携带后端决策元数据。
- 删除 `legacy-runtime-fallback-contract.ts`；历史会话只走导入边界。
- print、RPC、IM host 和安装后独立可执行产物继续提供原有 Tool、MCP、Skill、Extension、Memory、取消、恢复和进程清理行为。

### Desktop 与 IM

- 删除 Desktop Runtime selector、decision 和 Legacy migration backend，新增职责明确的 historical session import backend。
- Desktop knowledge factory/poller 和 IM coding-agent spec 不再传递或记录 Runtime backend。
- Go host protocol 与本地 HostClient 删除 RuntimeBackend 和 runtime decision frame 字段。
- Desktop Runtime canary 从差异比较工具改为单生产 Runtime 验收；命令固定为 `verify:ui:runtime-canary`。

### 架构审查

- `check-legacy-execution-retirement.mjs` 新增退役选择标记与退役文件守卫。
- 生产源码中出现 `--agent-runtime`、三个 Runtime 环境变量、`runtimeDecision`、`requestedBackend` 或 `effectiveBackend` 会直接失败。
- 退役 selector/decision/fallback 文件被恢复时会直接失败；测试 fixture 和历史文档不作为生产执行边统计。

## 类型校验取舍

- RPC 外部 JSONL failure frame 继续使用 TypeBox 校验。
- Desktop canary 的外部进程输出和 JSON 记录继续使用 Zod 校验。
- 已删除的 Runtime 选择 schema 不再保留；类型明确的进程内组合参数不新增重复运行时校验。

## 旧实现依赖变化

- 旧 Session 生产执行边：`0`。
- Runtime 对 Coding Agent 具体实现的反向依赖：`0`。
- 旧 Runtime 选择标记和退役选择文件：`0`。
- 保留的旧格式边界：`14`，均为 reader/import/public history 等数据兼容职责，不是旧执行后端。
- CLI、Desktop 和 IM 的生产入口均没有 Legacy fallback。

## 行为兼容性验证

- `bun run check:quick`：通过；架构、包边界、旧执行退役与格式边界守卫全部通过。
- CLI `bun run test`：34 个文件、183 项测试通过，包含真实安装产物、RPC、print、IM、Tool/MCP/Skill 动态变化、会话恢复和历史导入。
- Desktop `bun run test`：119 个文件、498 项测试通过，1 项平台测试跳过。
- Coding Agent RPC：2 个文件、20 项测试通过。
- IM Gateway：`internal/hostproto`、`internal/hostclient/local`、`cmd/im-gateway` 测试通过。

## 尚未完成的替换

- 本阶段已经完成生产入口的单 Runtime 切换，但代码和测试中仍存在部分 `Greenfield`、`Legacy`、`differential` 的迁移期命名。只有在不改变公共协议和测试 Oracle 含义时才应逐步中性化，不能以批量改名代替架构工作。
- 历史格式 reader/import 仍需长期保留，除非产品明确终止对应数据格式；它们不计为旧架构执行代码。
- 下一阶段应以生产稳定性为目标审查错误分类、崩溃恢复、观测字段和验收超时，而不是恢复双后端比较或 fallback。
