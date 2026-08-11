# 第 265 阶段：Greenfield 跨宿主功能验收

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

架构守卫只能证明依赖方向没有回退，包内测试也不能证明真实宿主进程能够正确装配新架构。本阶段在继续收口 Session 转换事务前，先建立 CLI、Desktop、IM 共用的功能验收基线，避免后续架构改动在单包测试通过的情况下破坏独立产物、Go HostClient 或 Electron 主进程。

本阶段不新增 Agent 功能，不调整 Tool、Prompt、模型、Session 或 Runtime 策略。测试只观察既有外部行为；验收中发现的构建问题以最小修改修复。

## 实施内容

- 新增根命令 `bun run verify:agent-hosts`，作为 Coding Agent、CLI、Desktop 与 IM 的统一确定性门禁。
- 门禁通过规范 `compile-standalone.mjs` 生成当前平台的临时单文件 Vetta CLI，测试结束后删除产物。
- 新增 Go 真实 Agent 验收场景，由 IM Gateway `hostclient/local` 启动该独立 CLI，而不是调用 TypeScript 内部对象或测试替身。
- 本地确定性 OpenAI Responses Provider 在第一次请求要求模型调用真实 `read` Tool，第二次验证 Tool Result 已进入模型请求，再返回最终文本。
- 验收新会话的持久化路径、`greenfield-im` requested/effective 决策、无 Legacy fallback、ownership lock 持有与释放。
- 关闭第一个进程后用同一 Session Path 恢复第二个进程，验证会话身份保持、继续 Prompt 成功及最终锁释放。
- Provider fixture 与会话场景分文件维护，避免把协议 fixture、配置生成和生命周期断言堆入单个大测试文件。
- 修复 IM Gateway 凭据测试的 Windows 隔离：测试同时设置 `HOME` 与 `USERPROFILE`，不再误读用户真实目录。

## 验收中发现并修复的问题

- CLI 声明构建无法命名 `GreenfieldRpcSessionAdapter.bash` 的推断类型；属性现在显式使用公开 `RpcSessionCapabilities["bash"]` 合同，不引用包内声明路径，运行时行为不变。
- 本地 workspace 链接未刷新导致 CLI 构建暂时无法解析已经声明的 `@vetta/ecosystem-adapter`；`bun install --frozen-lockfile` 恢复链接，未新增依赖。
- Desktop 的 `lucide-react@1.24.0` 发布产物引用但未包含 `currency.mjs`，Vite 依赖优化失败；升级到包含完整产物的兼容版本后，真实 Electron Canary 可启动。此修改只修复构建依赖，不改变 Agent 功能。

## 功能覆盖矩阵

| 宿主 | 验收层级 | 关键行为 |
| --- | --- | --- |
| Coding Agent | 包全量测试 | Session、Runtime Composition、Tool、MCP、Skill、Memory、Compaction 与 Extension 行为基线 |
| CLI | 包全量测试 + 独立产物 | 参数/模式/RPC、Runtime 选择、安装产物与进程退出语义 |
| Desktop | 包全量测试 + 双代 Electron Canary | 真实主进程装配、会话恢复、Scheduler、Batch、Knowledge、MCP、锁和 Endpoint 清理 |
| IM | Go 全量测试 + 真实 CLI 子进程 | HostClient 握手、Greenfield IM、Tool Loop、持久化恢复与 ownership lock |

## 旧实现依赖变化

- 本阶段没有新增旧实现生产依赖、Legacy fallback 或兼容执行入口。
- IM 真实验收明确断言 requested/effective backend 都是 `greenfield-im`，且 fallback reason 和迁移错误为空。
- CLI 的显式类型修复引用稳定 RPC 公共合同，不引用旧类或包内声明路径。
- 既有守卫继续报告旧执行入口、Runtime 反向依赖、compat 导出和 Greenfield product-core 边均为 `0/0`。

## TypeBox / Zod 判断

本阶段未引入 TypeBox 或 Zod。新增 Provider 输入只存在于测试进程内部，生产 OpenAI Responses 边界仍由现有 AI Provider 解析；IM 命令、事件与 Runtime 决策继续复用现有生产合同。为测试 fixture 再建立一套运行时 Schema 会重复生产解析职责，不能增加真实边界保证。

## 行为兼容性验证

- `bun run verify:agent-hosts` 已在最终实现上完整通过：独立 CLI 编译、IM Gateway 全量 Go 测试、Coding Agent 全量测试、CLI 全量测试和 Desktop 全量测试均成功。
- IM 真实 Agent 场景实际执行 3 次模型请求：首次 Tool Call、Tool Result 后续请求、恢复进程后的继续请求。
- CLI 全量测试：34 个文件、185 个测试通过。
- Desktop 全量测试：54 个文件、151 个测试通过。
- Coding Agent 全量测试：128 个文件通过、1 个文件跳过，891 个测试通过、17 个测试跳过。
- Desktop Greenfield Runtime 进程级 Canary 通过；第一代 PID `37104`、第二代 PID `10424`，两代退出码均为 `0`。
- Canary 验证 `desktopRestarted`、`sessionPersisted`、`sessionLocksReleased`、`knowledgeRawsUnlocked`、`endpointRemoved`、`providerStopped` 均为 `true`。
- `bun run check:quick` 在测试实现拆分后通过。
- 根 `bun run check` 通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 尚未完成的替换

- 本阶段建立的是跨宿主回归门禁，不代表旧实现依赖已经全部删除；旧执行入口和生产依赖归零仍由既有架构守卫持续约束。
- 下一阶段可在此基线上收口活动 Session 转换事务，统一 admission、prepare、commit、rollback 与 cleanup，并把 CLI、Desktop、IM 门禁作为行为不变的验收条件。
