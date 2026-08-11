# 第 270 阶段：SDK Session Host 组合边界拆分

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

旧执行实现依赖已经归零，但新的产品组合层仍需防止重新形成大文件。原 `coding-agent-sdk-host-adapter.ts` 共 603 行，同时负责公共 Tool 校验、内置 Tool 激活、模型选择、宿主服务创建、资源/MCP/Extension 所有权、固定与活动能力宿主以及 HTML 导出。本阶段只重构这些职责的内部边界，使 SDK Session Host 保持为 Coding Agent 包内的产品组合根，不新建包，也不把 `runtime-tools` 已持有的具体 Tool 实现搬回 Coding Agent。

## 实施前判断

- 公共 `createCodingAgentSession()`、`createCodingAgentHost()` 和 `createCodingAgentHostWithServices()` 签名不应改变。
- `greenfield_sdk_no_model`、`greenfield_sdk_custom_tool_invalid_schema` 和 `greenfield_sdk_custom_tool_invalid_input` 是既有错误值，必须保持。
- Resource Source 在创建成功后转移给 Session 持有，创建失败时由公共入口释放；该所有权时机不能因拆分改变。
- 内置 Tool 名称、动态 Tool 注册、MCP、Extension reload、模型选择、存储目标、HTML 导出和 Session Transition 都属于行为兼容范围。

## 实施内容

### SDK Session Host 目录

- 新增 `host/sdk-session/contracts.ts`，只保存宿主错误与内部组合结果合同。
- 新增 `custom-tool-adapter.ts`，集中公共 Tool TypeBox schema/input 校验与内置 Tool 激活名称检查。
- 新增 `initial-model.ts`，隔离初始模型和 thinking level 选择以及无模型错误。
- 新增 `session-capability-hosts.ts`，组装固定 Session 能力、活动 Session 能力、资源刷新、Bash、Tree Navigation 和 HTML 导出。
- 新增 `session-host.ts`，只负责认证、模型、设置、Resource、MCP、Extension、Storage 与 Runtime Session 的产品组合。
- 新增 14 行 `index.ts` 作为包内稳定聚合入口；三个公共入口和 Bootstrap 错误导出均迁移到该入口。
- 删除原 603 行 `host/coding-agent-sdk-host-adapter.ts`。拆分后最大模块为 `session-host.ts` 的 304 行，其余职责模块均不超过 188 行。

### 失败路径测试

- 新增非法 TypeBox schema 测试，确认返回原有 schema 错误码和 Tool 名称。
- 新增非法 Tool input 测试，确认公共 execute 不会在校验失败后执行。
- 新增无可用模型测试，显式固定空模型目录并确认内部宿主错误映射为稳定公共 SDK `NO_MODEL` 错误。

### 防回退守卫

- 将旧 `coding-agent-sdk-host-adapter.ts` 加入精确退役文件集合，未来恢复会直接失败。
- 对 `host/sdk-session/index.ts` 设置 50 行上限，对职责模块设置 400 行上限。
- 重写基线版本升级到 13，并新增治理回归测试验证聚合入口、职责模块和退役文件三类约束。

## TypeBox / Zod 判断

本阶段继续使用已有 TypeBox，但只放在公共 SDK Tool 的外部 schema 和运行时 input 边界。模型、设置、资源对象和能力宿主都是进程内已类型化依赖，不新增重复运行时校验，也不引入 Zod。这个选择保持“外部不可信数据运行时校验、内部组合静态类型约束”的边界。

## 旧实现依赖变化

- 旧 SDK Host 单文件已删除并加入永久退役守卫；旧路径生产与测试引用为 `0`。
- 新目录没有接回旧 `src/core`、`compat/*` 或 Runtime 反向依赖。
- 重写守卫结果继续保持：旧实现边 `0`、Runtime 反向依赖 `0`、旧文件 `0`、兼容导出 `0`。
- 14 个历史格式边界保持不变，只处理用户旧会话数据，不进入 SDK Session 执行。

## 行为兼容性验证

- 改动前 SDK 基线：6 个文件、31 项测试通过。
- 改动后 SDK 定向测试：6 个文件、34 项测试通过；新增 3 项失败路径测试。
- Coding Agent 重写治理测试：23 项通过。
- `bun run check:quick` 通过，新旧架构统计与包边界守卫无回退。
- `bun run check` 通过，覆盖 Biome、根/CLI/Desktop/Admin TypeScript 检查和全部质量守卫。
- `bun run verify:agent-hosts` 通过：独立 Vetta CLI 产物、IM Gateway 真实 Greenfield Agent、Coding Agent 功能套件、CLI 34 个文件/186 项测试、Desktop 121 个文件/511 项测试全部通过；Desktop 另有 1 项平台不适用测试跳过。
- 本阶段没有改动 Provider 或模型调用实现，验收使用确定性测试模型，没有发送新的计费 DeepSeek 请求。

## 本阶段结果

- 公共 SDK、CLI、Desktop 和 IM 继续经过同一新 Runtime 组合，没有恢复 Legacy 执行入口。
- 动态 Tool、Skill/Extension Source、MCP、模型、存储、Session Transition、错误和资源释放行为保持不变。
- SDK Session Host 仍属于 Coding Agent 产品组合层，但 Tool 实现仍由 `runtime-tools` 独立持有。
- 旧 603 行单文件无法在不触发治理门禁的情况下恢复，新目录也不能无约束膨胀。

## 尚未完成的替换

- 没有待替换的旧 SDK Session Host 执行路径；本阶段治理的是新架构内部维护性。
- `session-host.ts` 的 304 行仍包含同一创建事务中的产品资源组装，目前继续拆分会引入只使用一次的抽象，不符合最小实现原则。
- 下一阶段应重新按职责和变化轴审计剩余大模块，优先处理同时承担多种状态所有权且能用既有行为测试隔离的模块；不能仅按行数机械拆分，也不能顺带改变功能。
