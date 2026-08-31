# Coding Agent 与多主 Agent 基座

本文说明生产 `CodingAgentRuntimeComposition` 如何使用 `@vetta/runtime-core/agents`。它补充
[Runtime Core 自定义 Agent 指南](../../runtime-core/docs/custom-agents.md)：后者解释通用基座，本文只解释 Coding Agent
这个复杂产品 Agent 的接线、配置和生命周期。唯一 Host 的所有权决策见
[ADR-0084](../../../docs/adr/0084-runtime-host-owns-agent-control-plane.md)。

## 结论

Coding Agent 现在是 Registry 中 id 默认为 `coding-agent` 的普通主 Agent。它没有复制一套 Registry，也没有由另一主 Agent
派发。区别只在于它的 Session Definition 不是一段静态 Prompt，而是由产品 Composition 在创建会话时装配 Tool、MCP、
Skill、Plugin、Context、模型绑定和 Session Extension，再交给 `RuntimeHost.agents` 做唯一一次能力编译。

```text
应用 Composition Root
├── RuntimeObservationHub
└── RuntimeHost（唯一生命周期根）
    ├── Agent 控制面
    │   └── Registry: coding-agent revision N
    │       └── RuntimeAgentInstance（每个活动会话一个，创建时固定 revision N）
    │           └── RuntimeAgentSession（每个产品 Session 一个）
    │               └── Runtime Snapshot generation（每个 Turn 获取不可变 lease）
    └── RuntimeHostSessionBackend（平台持久化与产品 Session 端口）
```

生产链路是：

```text
createCodingAgentRuntimeComposition()
  -> 创建/取得 RuntimeHost 内置的 RuntimeAgentRuntime 控制面
  -> 复用工作区基础设施，等待 RuntimeHost 的 Session 创建请求
  -> 每个请求从 Registry 创建独立 RuntimeAgentInstance
  -> Definition.prepareSession() 直接准备产品 RuntimeAgentSessionPlan
  -> RuntimeAgentSession 编译 Prompt / Tool / MCP Feature / Extension
  -> KernelRuntimeSessionBackend 使用该 Session 的 snapshotProvider 执行 Turn
```

这里必须保持一个关键不变量：同一个产品 Session 只有 `RuntimeAgentSession` 一个能力编译和 Snapshot Provider 事实源。
Coding Agent 的 MCP freshness、Conversation、Hook 和其它产品外围生命周期只装饰该 Provider，不再创建第二套
`RuntimeCapabilityComposition`。

## 两种开箱方式

### 默认独立控制面

CLI、SDK 或测试直接调用 Composition 时，不传 `agentRuntime` 即可。Composition 会创建并拥有独立
`RuntimeAgentRuntime`，发布内置 execution-compatible Definition；每次创建 Session 时再创建 Instance，并在 `dispose()` 时释放
Session、Instance、控制面和产品 Hub。它是模块化运行方式，不会产生第二个 `RuntimeHost`。

```ts
import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";

const composition = await createCodingAgentRuntimeComposition({
  ...codingAgentPlatformOptions,
});

console.log(composition.agentRuntime);
// { agentId: "coding-agent" }
// Session 创建后可用 composition.readSessionAgentIdentity(sessionId) 查询完整身份。

await composition.dispose();
```

示例中的 `codingAgentPlatformOptions` 代表现有的模型、Conversation persistence、Tool environment 等必填平台端口，
不是仓库导出的对象。

这里的“独立控制面”只表示 Composition 自己拥有 `RuntimeAgentRuntime`；真正创建 Conversation Session 时，SDK、CLI
或测试仍会在外层建立一个 RuntimeHost。Composition 本身只是产品 Backend 与 Agent Instance 的装配结果，不是第二个
Session Host。

### 应用使用唯一 RuntimeHost

一个进程需要承载多个工作区或多个平级主 Agent 时，由应用组合根创建唯一 `RuntimeHost`。Backend factory 在 Host
构造期间取得 `agents`，发布 Coding Agent Definition，并把同一控制面交给工作区 Composition/Backend Pool：

```ts
import {
  publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";
import { RuntimeHost, RuntimeObservationHub } from "@vetta/runtime-core";

const applicationHub = new RuntimeObservationHub();
const host = new RuntimeHost({
  observationPort: applicationHub,
  createSessionBackend: ({ agents }) => {
    publishCodingAgentExecutionRuntimeDefinition(agents);
    return createApplicationCodingAgentBackendPool({
      ...codingAgentPlatformOptions,
      agentRuntime: { runtime: agents, agentId: "coding-agent" },
      observationHub: { parent: applicationHub },
    });
  },
});

await host.createSession({ cwd, model });
await host.close(); // 统一关闭 Session、Backend Pool、Agent 控制面和直接拥有的根 Hub
```

`createApplicationCodingAgentBackendPool()` 代表应用自己的 `RuntimeHostSessionBackend` 工厂，不是 Coding Agent 导出的隐藏 API。
注入 `runtime` 后，Registry 的发布权属于 RuntimeHost，所以不能同时传 `agentRuntime.definition` 或
`agentRuntime.source`。Desktop 采用这一方式：各工作区 Composition 共享 Registry，每个会话拥有独立 Instance。
同一工作区的多个会话可继续复用 MCP Source、工具目录和持久化基础设施；关闭一个会话不会关闭共享连接。

## 名称相似但职责不同的对象

当前代码中有几类历史上都带 `Host` 的对象，但它们不能合并为一个万能管理器：

| 对象 | 唯一职责 | 是否是多主 Agent 根 |
| --- | --- | --- |
| `RuntimeHost` | Agent Backend 准入、Conversation Session 索引、公共控制面与统一关闭 | 是 |
| `RuntimeActiveSessionHost` | 在一个产品 Session facade 内串行化 new/resume/fork，并原子切换当前 identity | 否 |
| 公共 `CodingAgentHost` | SDK 便利所有权组，批量持有和关闭多个配置彼此隔离的 Coding Agent Session | 否 |
| `DesktopRuntimeBackendPool` | 按 workspace/scope 复用 Coding Agent Composition，并实现 RuntimeHost Backend Port | 否 |
| `CatalogRoutedRuntimeHostSessionBackend` | 按持久化格式归属选择 legacy/greenfield Backend，禁止错误格式回退 | 否 |

公共 `CodingAgentHost` 保留名称是为了 SDK 兼容。它的每个成员允许使用不同 cwd、Storage、Tool、MCP、Extension Source
和模型资源，因此每个成员内部拥有隔离的 Composition + RuntimeHost；它不提供 Agent Registry，也不能用来安装不同
`agentId`。需要在一个进程中动态创建、替换或退役多个平级主 Agent 时，应使用 `RuntimeHost.installAgent()`。

Desktop 的三层选择也不是重复路由：`RuntimeHost.agentBackends` 按 Agent/revision 路由，Catalog Router 按磁盘格式路由，
Backend Pool 按 workspace Composition scope 路由。三个 key、生命周期和失败语义均不同；合并后会让 Agent 更新、格式兼容
和工作区资源所有权互相耦合。

## 自定义 Coding Agent revision

标准 Coding Agent 的 Prompt、Tool、MCP、Plugin 和模型配置仍优先使用
`CodingAgentRuntimeCompositionOptions` 中对应的产品 Port。这些配置参与产品 Session 装配；多主 Agent 基座不认识 Profile、
MCP 配置格式或平台连接。

若需要把一组跨 Session 的变更作为 Agent revision 发布，可创建 execution-compatible Definition，并在产品资源装配完成后
变换通用 Session Definition：

```ts
import {
  createCodingAgentExecutionRuntimeDefinition,
  publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";

const revision2 = createCodingAgentExecutionRuntimeDefinition({
  id: "coding-agent",
  transformSessionDefinition(_context, current) {
    return {
      ...current,
      capabilities: {
        ...current.capabilities,
        instructions: [
          ...current.capabilities.instructions,
          {
            id: "company.review-policy",
            content: "Before completing a coding task, report unresolved compatibility risks.",
            priority: 50,
          },
        ],
        features: [...current.capabilities.features, companyToolFeature],
      },
    };
  },
});

publishCodingAgentExecutionRuntimeDefinition(host, {
  definition: revision2,
  source: { id: "coding-agent.builtin", revision: "2" },
});
```

`companyToolFeature` 是宿主提供的普通 Runtime Feature；Tool、MCP 和 Prompt 的完整通用写法见
[自定义 Agent 指南](../../runtime-core/docs/custom-agents.md)。外部配置仍需先做 Schema 校验和受控组件引用解析，不能把函数、
凭证或连接对象直接从配置文件反序列化。

### 更新何时生效

- 发布新 revision 后，新建 Session/Instance 取得新 revision，不需要重建 Composition；
- 已存在的 Session/Instance 继续使用它创建时固定的旧 revision；
- 已运行的 Session、在途 Turn 和 Snapshot lease 不变；
- Coding Agent 产品 facade 当前不暴露 Definition 热 rollout；要切换 execution Definition，应关闭并恢复对应 Session；
- Conversation continuation 只原子重绑 Session identity，不改变 revision 或 lease。

这个边界使 Prompt、Tool schema、handler、模型绑定和 Extension 不会在一次运行中跨代混用。

`agentRuntime.instanceId` 已移除，Composition 不再代表单一实例。调用方应从会话查询运行身份，不持久化 instanceId。
恢复历史保留 Conversation identity，但会分配新的 Instance；普通新建与恢复默认使用当前 Definition revision。
这不会改变历史格式或重放模型/工具，也不等于进程、文件或权限隔离。详见
[ADR-0095](../../../docs/adr/0095-conversation-owned-agent-instances.md)。

## 两个 Definition 工厂不要混用

| API | 用途 |
| --- | --- |
| `createCodingAgentExecutionRuntimeDefinition()` | 生产 Definition；在 Instance 创建时获得显式 Session Plan 工厂，随后直接执行 `prepareSession()` |
| `createCodingAgentRuntimeDefinition()` | 较低层的产品 Adapter；调用者自己实现完整 Instance/Session assembler，并把 Profile 解析成普通 Instruction |

若目的是自定义一个与 Coding Agent 无关的新主 Agent，直接使用 Runtime Core 的 `defineRuntimeAgent()`；不要复用 Coding Agent
的 execution Definition，也不要把业务 Profile 下沉到基座。

## 观测与日志

RuntimeHost Agent 控制面的 `runtime.agent/lifecycle` 事件直接进入应用 Hub；每个 Coding Composition 的 Tool、MCP、Session 初始化和安全
Session 摘要先进入自己的产品子 Hub，再无损汇聚到应用 Hub。两条路径使用同一套
`RuntimeObservationRecord` identity，可由上层统一接到日志、Metrics、Trace event、JSONL 或未来 UI Adapter。

模块仍可在没有应用 Hub 时给自己的子 Hub 注册 Adapter 独立观测。统一的是安全信封、identity、路由和故障隔离，不是把
日志、原生 Span、审计与业务事件合成一种语义。

SDK Session 现在从 Composition 子 Hub 取得非所有权 Publisher，同时注入其内部 RuntimeHost 与
RuntimeActiveSessionHost。因此 workspace 准备、队列 sidecar、Session observer/listener、Session 切换清理，以及
Agent/Tool/MCP/Prompt 等产品事件都进入同一观测树；关闭 RuntimeHost 不会提前关闭 Composition Hub。没有注入上层 Hub
时仍可在 `composition.observations` 本地挂 Adapter 单独观测。高层 `createCodingAgentSession()` 可通过
`observationHub.parent/routes` 完成同样接线，不需要深度导入 Composition 实现。

Desktop 当前只把关键控制面 Observation 投影为日志：

- 成功的 revision publish/retire/remove 与 Session identity rebind；
- 所有 lifecycle failure；
- 只包含 Agent/Revision/Instance/Session identity、Source 元数据和 `category/name/code`；
- 不包含 Prompt、用户消息、Tool/MCP 参数或结果、凭证、原始错误 message/stack；
- 普通 Session create/close 成功不逐条记录，避免高频噪声。

自动重试的状态机、退避、取消和 RuntimeHost 失败事件顺序由 Runtime Core 的
`RuntimeTurnRetryCoordinator` / `withRuntimeHostSessionRetry()` 统一实现。Coding Agent 只提供设置来源、历史失败兼容和
SDK/RPC 事件投影。Desktop 将同一个 RuntimeHost Publisher 注入工作区 Composition 与重试装饰器，因此
`runtime.retry.lifecycle` 和 `runtime.retry.issue` 会与 Agent/Session 事件进入同一观测树；安全 payload 不包含错误正文、
Prompt 或用户内容。

Context/Compaction 采用相同边界：Runtime Core 的 Context Strategy、Committer 与 Session Controller 负责 Turn 检查点、
取消、持久化和 continuation 事务，并提供通用 usage tracker 与连续失败熔断器；Coding Agent 保留阈值、overflow、
keep-tail、摘要格式、Memory、Hook、Extension、图片恢复和 Prefire。`DefaultCodingAgentContextRuntime` 只负责 Turn-bound
generation 与合同委托，自动策略、手动策略和提交后生命周期互不混合。Prefire 的 cached/failed/cancelled 通过
`coding-agent.context.compaction-prefire` 进入产品子 Hub，再由上层统一汇聚；安全 payload 不包含摘要、消息、凭证或错误正文。

Tool 整组替换（当前用于 Session execution mode）由 `runtime-tools` 的 `GenerationalCodingToolCatalog` 统一持有代际和 lease；
Coding 只选择具体 Sandbox/后台 Tool 与激活策略。Subagent 的 FIFO、并发、恢复和 delivery generation 继续由
`runtime-subagents` 独立持有，Coding 只组合 Profile、child Session、持久化和模型可见 Tool。协调器、恢复、通知投递及
Session observation 的失败通过 `coding-agent.subagent.issue` 汇入同一观测树，不包含任务正文、路径或错误 message。

Session Extension 的 Definition 排序、初始化回滚、Service/Signal/Endpoint、Document Participant、continuation、迟订阅状态与
逆序释放全部由 Runtime Core 的 `SessionExtensionComposition` 持有，并通过标准 RuntimeHost Adapter 暴露控制面。Pi
compatibility 仍是 Coding Agent 的第三方协议反腐层；只有已经存在 Vetta native 合同且能满足原子注册、Turn generation 和
owned teardown 的子集才会映射。Pi TUI、近似事件以及尚无稳定所有权的 flag/provider/event-bus 明确 fail-closed。

## 生命周期与特殊说明

- 应用只调用 `RuntimeHost.close()`；Host 依次关闭 Session、拥有的 Backend、Agent 控制面和直接注入的根 Observation Port。
- 子 Agent 的 Coding Composition 可共享父级 Agent 控制面和 `agentId`，但创建独立 Instance；这只是资源复用，不改变其产品层主从语义。
- `agentRuntime.instanceConfiguration` 作为 `unknown` 传给 execution Definition 的 transform；transform 必须自行校验。
  标准 Definition 的 Plan 工厂与它分字段传递，不再借用 Session configuration 传一次性回调。
- 相同 `agentId` 只能由一个 Source 拥有；更新时保持 `source.id`，增加 `source.revision`。
- Definition transform 必须保留仍需使用的 `modelBindingProvider`、Session Extensions 和释放合同；完全替换返回值意味着调用者
  接管这些通用合同的正确性。
- Observation 是只读且失败隔离的。授权、重试、修改 Prompt 或阻止 Tool 必须使用 Tool Policy、Feature、Interceptor 或
  Session Extension，不能在日志 Adapter 中实现。
