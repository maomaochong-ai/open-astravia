# 第 289 轮：SDK Session Host 生产合同收口

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

第 288 轮已经将 RPC 与 CLI Runtime Host 收口为生产身份，但 `host/sdk-session` 内部仍保留 44 个 `GreenfieldSdk*`、`CodingAgentGreenfield*` 迁移符号，共 281 次引用；两个外围 SDK Host 消费者另有 3 个迁移符号、5 次引用。公开 `@vetta/coding-agent/sdk` 合同已经使用稳定名称，因此本轮只清理 SDK Session Host 的内部生产身份，不改变公开 SDK API。

本轮不修改 Session 创建、恢复、分支、动态 Tool/MCP/Skill、模型切换、Bash、Compaction、重试、事件、统计、存储和释放语义；既有错误码和值字符串保持不变。

## 实施内容

### 合同收口

- 删除 `runtime-contracts.ts` 中 18 个只转发公开 SDK 类型的 `GreenfieldSdk*` 别名；
- 内部模块直接使用 `CodingAgentSession`、`CodingAgentFixedSession`、`CodingAgentPromptOptions`、`CodingAgentSessionToolDefinition` 等公开稳定值类型；
- 只保留三个真正的内部端口，并改名为 `CodingAgentSdkSessionCapabilityPort`、`CodingAgentSdkActiveSessionCapabilityPort` 和 `CodingAgentSdkSessionRuntimePort`；
- `public-api/runtime/session.ts` 不再经过 Greenfield 类型别名连接能力宿主。

### 实现生产身份

- Session Adapter、Active Session Adapter、Capability Host、Runtime Binding、事件映射和 Runtime Factory 全部改用 `CodingAgentSdk*` 生产名称；
- 存储目标直接复用公共 `CodingAgentSessionStorageTarget`，存储解析结果、错误类型和解析函数改用稳定名称；
- `session-host.ts` 直接调用 `createCodingAgentSdkSession`，不再依赖迁移工厂身份；
- `CodingAgentSdkBashAdapter` 与 `CodingAgentSdkExtensionTransitionAdapter` 直接使用稳定端口和资源类型，不再依赖 SDK Session Host 的迁移名称；
- 两个 SDK Session 测试文件改为 `coding-agent-sdk-session-*`，测试行为场景保持不变。

### 上游合同边界

`GreenfieldRuntimeSession` 仍由 `@vetta/runtime-core` 定义，是跨包 Runtime 合同。本轮保留其 24 次引用，没有在 Coding Agent 内创建包装类型或别名。该名称是否调整必须由 `runtime-core` 的独立合同审计决定。

### 类型校验判断

本轮只调整进程内 TypeScript 类型所有权与实现身份，没有新增外部不可信结构化输入。SDK 参数、Tool 输入和 RPC 帧仍由既有边界校验负责，因此不引入 TypeBox 或 Zod。

### 防回退门禁

- 迁移残留门禁新增 SDK Session Host、`coding-agent-sdk-*` 宿主消费者、SDK 公共边界、Runtime Session 公共 API 和 SDK 测试扫描范围；
- `GreenfieldSdk` 迁移标识符和 `CodingAgentGreenfield*` 标识符必须保持为 `0`；
- SDK Session 边界中以 `greenfield` 开头的文件名必须保持为 `0`；
- `GreenfieldRuntimeSession` 被明确排除，防止把上游合同误判为 Coding Agent 迁移身份；
- 新增门禁测试验证迁移函数、迁移类型和迁移文件名会被拒绝，上游类型可以继续使用。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- SDK 公共合同中的迁移名称：保持 `0`；
- SDK Session Host 核心迁移符号：`44` 个、`281` 次引用收敛为 `0`；
- SDK Host 外围消费者迁移符号：`3` 个、`5` 次引用收敛为 `0`；
- SDK Session 生产链合计：`47` 个、`286` 次引用收敛为 `0`；
- SDK Session 迁移文件名：`2 -> 0`；
- 退役迁移文件和引用：保持 `0/0`；
- 上游 `GreenfieldRuntimeSession` 引用：保留 `24`，不纳入 Coding Agent 清理指标。

迁移门禁新增输出为：

```text
SDK Session migration identities=0/0
filenames=0/0
```

## 行为兼容性验证

- SDK 定向测试：3 个文件、20 项测试通过；
- 迁移残留门禁：19 项测试通过；
- Coding Agent 全量：137 个文件通过、1 个文件跳过，935 项通过、17 项跳过；
- `bun run verify:agent-hosts` 通过：独立 Vetta CLI、IM Gateway、Coding Agent、CLI 和 Desktop 全部通过；
- Desktop 功能套件：119 个文件、501 项通过，另 1 项跳过；
- 根级 `bun run check` 通过：Root、CLI、Desktop、Admin 类型检查、Biome 和全部质量守卫均通过。

首次 `check:quick` 只发现 8 个格式与导入排序问题，使用仓库 Biome 修复。首次根级 `bun run check` 发现 Bash Adapter 和 Extension Transition Adapter 仍引用已改名类型；这说明 Vitest 转译通过不能替代完整类型检查。修正两个消费者、扩大门禁范围后，根 `tsgo --noEmit`、第二次 `check:quick` 和完整 `bun run check` 全部通过。所有行为测试和宿主验收均未发现功能回归。本轮没有发送外部真实模型请求。

## 尚未完成的替换

- `public-api/bootstrap.ts` 仍有 `CodingAgentGreenfieldExtensionHostCapabilities` 与 `resolveCodingAgentGreenfieldExtensionCompatibility`，应在下一阶段审计 Extension Host 的生产身份和真实兼容职责；
- `@vetta/runtime-core` 的 `GreenfieldRuntimeSession` 仍是跨包正式合同，是否改名不能由 Coding Agent 单方面决定；
- 既有错误码、协议值和历史格式中仍可能包含 `greenfield` 字符串，这些是兼容合同，不能按名称直接删除；
- Coding Agent 其他测试目录仍存在描述旧/新差异的 Greenfield 基线，需要按领域逐项判断，不能纳入本轮 SDK Host 清理。

下一阶段应审计 Extension Host 的公开能力与兼容解析器：先区分当前生产合同、真实历史兼容和纯迁移命名，再决定哪些实现原地改名、哪些兼容逻辑必须保留，并为其建立独立零回退门禁。
