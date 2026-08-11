# 第 210 阶段：公开 SDK 合同与 Greenfield 核心门面

## 1. 阶段目标

本阶段为公开 SDK 建立一条可运行、可验证的 Greenfield 并行路径，但不切换现有 `createAgentSession`、`AgentSession` 或 `runRpcMode(session)`。

目标不是把旧 `AgentSession` 的全部职责复制成另一个大类，而是：

1. 固化当前公开 SDK 的类型和兼容责任；
2. 将核心会话能力收敛为窄 Runtime Port；
3. 使用完整执行观察流适配现有 Agent 事件；
4. 通过真实 Greenfield Composition 验证核心门面；
5. 明确记录尚未迁移的外围能力，禁止静默丢失功能。

## 2. 审计结论

生产 CLI 和 Desktop 已不再调用 coding-agent 旧 `createAgentSession`，但公开 SDK 仍有真实兼容责任：

- 包根继续导出 `AgentSession`、`createAgentSession` 和 `runRpcMode`；
- SDK examples 中有 24 处 `createAgentSession()` 调用；
- `CreateAgentSessionOptions` 当前有 36 个字段；
- `CreateAgentSessionResult` 有 3 个字段；
- `AgentSession` 实例有 98 个公开成员；
- 文档仍公开原始 `agent: Agent`、具体 `SessionManager`/`ResourceLoader` 注入以及 Legacy RPC 调用方式。

因此，直接把公开工厂切换到 Greenfield 会同时触碰核心执行、产品能力、具体旧实现注入和公开类型，不具备一次性安全切换条件。

## 3. 实施内容

### 3.1 建立穷尽式 SDK 兼容清单

新增 `sdk-compatibility-inventory.ts`，使用 TypeScript `satisfies Record<keyof ...>` 对公开合同做编译期穷尽检查：

- 36 个创建参数全部分类；
- 3 个工厂返回字段全部分类；
- 98 个 `AgentSession` 实例成员全部分类。

分类结果：

| 分类 | Session 成员数 | 含义 |
| --- | ---: | --- |
| `greenfield-core` | 16 | 已进入本阶段 Greenfield 核心门面 |
| `runtime-capability` | 55 | Runtime 已有或应有中立能力端口，后续组合进门面 |
| `product-adapter` | 19 | Tool、Extension、MCP、Memory 等产品能力，保留在 coding-agent 适配层 |
| `legacy-concrete` | 8 | 原始 `Agent`、具体 Manager、内部 Store/Runner 等旧实现泄漏 |

以后公开 option、返回字段或 Session 成员发生变化而未更新清单时，类型检查会直接失败。

### 3.2 建立 Greenfield SDK 核心合同

新增 `GreenfieldSdkSessionCore`，本阶段闭合以下能力：

- `prompt`、`steer`、`followUp`、`abort`；
- `subscribe`；
- `state`、`messages`、`model`、`thinkingLevel`、`isStreaming`；
- `sessionId`、`sessionFile`；
- `setModel`、`setThinkingLevel`；
- `dispose`、`close`。

同时新增 `GreenfieldSdkSessionRuntimePort`。SDK 门面只依赖该结构化端口，不依赖 `GreenfieldRuntimeSession` 的具体实现，更不依赖旧 coding-agent `AgentSession`。

### 3.3 建立单一 Runtime 绑定边界

`bindGreenfieldSdkSessionRuntime` 是唯一感知 `GreenfieldRuntimeSession` 具体表面的 SDK 组合边界。它从真实 Session 的 Core Assembly 提取：

- 生命周期和会话路径；
- Prompt、Abort、状态和消息读取；
- Model Controller；
- 完整执行观察流；
- Runtime 资源释放。

门面本身只接收窄端口，因此后续可以用其他等价 Runtime 实现替换绑定，而不改 SDK 会话逻辑。

### 3.4 复用完整执行观察合同

SDK 事件适配没有从面向 UI 的 `SessionEvent` 反推旧事件，而是使用 Runtime 已有的 `RuntimeSessionExecutionObservation`。

该观察合同保留：

- Agent、Turn 和 Message 生命周期；
- 完整消息身份；
- Assistant 流事件；
- Tool 参数、增量结果、阶段、最终结果和时序。

适配器将其映射为现有 `AgentEvent`，因此核心 SDK 订阅者仍能观察 `agent_start`、`turn_start`、`message_start`、`tool_execution_start` 等既有事件。监听器异常继续被隔离，不影响 Turn 结果。

### 3.5 固化包根公开合同

新增包根 SDK 合同测试，从现有 `src/index.ts` 验证：

- `createAgentSession` 仍符合现有 options/result 签名；
- `runRpcMode` 仍接受现有 `AgentSession` 与 `RunRpcModeOptions`；
- 本阶段没有切换或删除任何公开导出。

### 3.6 扩展架构守卫

架构守卫新增 `sdk-compatibility` 分类，预算为 2 条产品 Core 合同边：

- 现有 SDK Session/Prompt 事件类型；
- Coding Agent 自定义消息类型。

这两条是公开产品合同，不是 Legacy 执行边。守卫另外明确禁止 `public-api/sdk/` 导入：

- 旧 `core/agent-session.ts`；
- 旧 `core/sdk.ts`；
- `AgentSession` 或 `createAgentSession` 执行符号。

最终产品 Core 边界为 95 条：adapter 84、composition 5、rpc 4、sdk 2。

## 4. 测试与验证

本阶段新增测试覆盖：

- SDK 创建参数、返回字段和 Session 成员兼容分类；
- Prompt/Steer/Follow-up 参数映射；
- Model 与 Thinking 控制；
- 完整执行观察事件到旧 Agent 事件的映射；
- 监听器异常隔离；
- 幂等关闭和 Runtime 所有权释放；
- 包根公开 SDK 类型签名；
- Greenfield SDK 门面禁止回接 Legacy 执行；
- 真实 Composition 创建 Session、执行 Prompt、持久化消息、投影状态和释放资源。

验证结果：

- SDK 定向测试：4 个文件、7 项通过；
- Legacy execution/SDK 架构守卫测试：9 项通过；
- 真实 Greenfield SDK 集成：完成一次真实模型流替身调用，得到 user/assistant 消息并保持既有 Agent 事件顺序；
- `bun run check:quick`：通过；
- `bun run check`：通过，包括 Biome、根类型检查、CLI 类型检查、Desktop `tsc`、Admin `tsc -b` 和全部质量守卫；
- 架构守卫：0 条 Legacy 执行边、8 条保留格式边、95 条已分类产品 Core 边。

## 5. 未切换内容

本阶段不代表公开 SDK 已完成迁移，以下能力仍由旧实现提供：

- 公开 `createAgentSession` 的 36 个 option 到 Greenfield Composition 的完整装配；
- `extensionsResult` 与 `modelFallbackMessage` 返回语义；
- Compaction、Retry、Bash、Queue、Session Navigation 等外围 Session 方法；
- Todo、Background Task、Subagent、MCP、Memory 和 Extension 的外围 SDK 事件；
- `resourceLoader`、`sessionManager`、`settingsManager` 等具体旧对象注入；
- 原始 `session.agent` 可写表面；
- `runRpcMode(session)` 的公开切换。

公开入口仍继续使用旧实现，因此本阶段没有功能回退，也没有用未完成门面替换用户路径。

## 6. 下一阶段入口

第 211 阶段建议完成“SDK 工厂装配与外围能力兼容”，仍不立即切换公开入口：

1. 建立 Greenfield SDK Factory，将 36 个 option 按兼容清单映射到 Bootstrap、Composition 和产品适配器；
2. 补齐 `extensionsResult`、模型恢复与 `modelFallbackMessage`；
3. 将已有 Runtime capability 组合进门面，优先处理 Queue、Compaction、Session Navigation 和 Context Usage；
4. 补齐 Todo、Background、Subagent、MCP、Memory 等外围事件；
5. 对 Legacy Factory 与 Greenfield Factory 运行同一组差异合同测试；
6. 对 `legacy-concrete` 项逐项决定兼容适配、明确弃用或版本化迁移，禁止把具体旧对象下沉进 Runtime Core。

只有 Factory 输入、返回值、核心行为和外围能力全部等价后，才进入公开 `createAgentSession` 的切换阶段。
