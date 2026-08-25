# Coding Agent 与多主 Agent 基座

本文说明生产 `CodingAgentRuntimeComposition` 如何使用 `@vetta/runtime-core/agents`。它补充
[Runtime Core 自定义 Agent 指南](../../runtime-core/docs/custom-agents.md)：后者解释通用基座，本文只解释 Coding Agent
这个复杂产品 Agent 的接线、配置和生命周期。

## 结论

Coding Agent 现在是 Registry 中 id 默认为 `coding-agent` 的普通主 Agent。它没有复制一套 Registry，也没有由另一主 Agent
派发。区别只在于它的 Session Definition 不是一段静态 Prompt，而是由产品 Composition 在创建会话时装配 Tool、MCP、
Skill、Plugin、Context、模型绑定和 Session Extension，再交给 `RuntimeAgentHost` 做唯一一次能力编译。

```text
应用 Composition Root
├── RuntimeObservationHub
└── RuntimeAgentHost
    └── Registry: coding-agent revision N
        └── RuntimeAgentInstance（每个 Coding Composition 一个，固定 revision N）
            └── RuntimeAgentSession（每个产品 Session 一个）
                └── Runtime Snapshot generation（每个 Turn 获取不可变 lease）
```

生产链路是：

```text
createCodingAgentRuntimeComposition()
  -> 创建/取得 RuntimeAgentHost
  -> 从 Registry 创建 RuntimeAgentInstance
  -> 产品 Session 初始化并产出未编译 RuntimeAgentSessionDefinition
  -> RuntimeAgentSession 编译 Prompt / Tool / MCP Feature / Extension
  -> KernelRuntimeSessionBackend 使用该 Session 的 snapshotProvider 执行 Turn
```

这里必须保持一个关键不变量：同一个产品 Session 只有 `RuntimeAgentSession` 一个能力编译和 Snapshot Provider 事实源。
Coding Agent 的 MCP freshness、Conversation、Hook 和其它产品外围生命周期只装饰该 Provider，不再创建第二套
`RuntimeCapabilityComposition`。

## 两种开箱方式

### 默认私有 Host

CLI、SDK 或测试直接调用 Composition 时，不传 `agentRuntime` 即可。Composition 会创建并拥有私有 Host，发布内置
execution-compatible Definition，创建一个 Instance，并在 `dispose()` 时依次释放 Session、Instance、Host 和产品 Hub。

```ts
import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";

const composition = await createCodingAgentRuntimeComposition({
  ...codingAgentPlatformOptions,
});

console.log(composition.agentRuntime);
// { agentId: "coding-agent", instanceId: "...", revisionId: "..." }

await composition.dispose();
```

示例中的 `codingAgentPlatformOptions` 代表现有的模型、Conversation persistence、Tool environment 等必填平台端口，
不是仓库导出的对象。

### 应用共享 Host

一个进程需要承载多个工作区或多个平级主 Agent 时，由应用组合根拥有 Host。先发布 Coding Agent Definition，再把同一 Host
注入每个 Composition：

```ts
import {
  createCodingAgentRuntimeComposition,
  publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";
import { RuntimeAgentHost, RuntimeObservationHub } from "@vetta/runtime-core";

const applicationHub = new RuntimeObservationHub();
const host = new RuntimeAgentHost({ observationPort: applicationHub });

publishCodingAgentExecutionRuntimeDefinition(host);

const composition = await createCodingAgentRuntimeComposition({
  ...codingAgentPlatformOptions,
  agentRuntime: { host, agentId: "coding-agent" },
  observationHub: { parent: applicationHub },
});

await composition.dispose(); // 只关闭自己的 Session、Instance 和产品子 Hub
await host.close();           // 应用关闭所有 Composition 后再关闭共享 Host
await applicationHub.close();
```

注入 Host 后，Registry 的发布权属于 Host 所有者，所以不能同时传 `agentRuntime.definition` 或 `agentRuntime.source`。Desktop
采用这一方式：进程级 Host 注入 `DesktopRuntimeBackendPool`，各工作区 Composition 拥有独立 Instance，但共享 Registry。

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

- 发布新 revision 后，新建 Composition/Instance 取得新 revision；
- 已存在的 Composition/Instance 即使之后再创建 Session，也继续使用它创建时固定的旧 revision；
- 已运行的 Session、在途 Turn 和 Snapshot lease 不变；
- Coding Agent 产品 facade 当前不暴露热 rollout；要切换 revision，应关闭并重建对应 Composition/Instance；
- Conversation continuation 只原子重绑 Session identity，不改变 revision 或 lease。

这个边界使 Prompt、Tool schema、handler、模型绑定和 Extension 不会在一次运行中跨代混用。

## 两个 Definition 工厂不要混用

| API | 用途 |
| --- | --- |
| `createCodingAgentExecutionRuntimeDefinition()` | `createCodingAgentRuntimeComposition()` 的生产执行桥；它消费 Composition 内部的一次性 Session 装配请求 |
| `createCodingAgentRuntimeDefinition()` | 较低层的产品 Adapter；调用者自己实现完整 Instance/Session assembler，并把 Profile 解析成普通 Instruction |

若目的是自定义一个与 Coding Agent 无关的新主 Agent，直接使用 Runtime Core 的 `defineRuntimeAgent()`；不要复用 Coding Agent
的 execution bridge，也不要把业务 Profile 下沉到基座。

## 观测与日志

共享 Host 的 `runtime.agent/lifecycle` 事件直接进入应用 Hub；每个 Coding Composition 的 Tool、MCP、Session 初始化和安全
Session 摘要先进入自己的产品子 Hub，再无损汇聚到应用 Hub。两条路径使用同一套
`RuntimeObservationRecord` identity，可由上层统一接到日志、Metrics、Trace event、JSONL 或未来 UI Adapter。

模块仍可在没有应用 Hub 时给自己的子 Hub 注册 Adapter 独立观测。统一的是安全信封、identity、路由和故障隔离，不是把
日志、原生 Span、审计与业务事件合成一种语义。

Desktop 当前只把关键控制面 Observation 投影为日志：

- 成功的 revision publish/retire/remove 与 Session identity rebind；
- 所有 lifecycle failure；
- 只包含 Agent/Revision/Instance/Session identity、Source 元数据和 `category/name/code`；
- 不包含 Prompt、用户消息、Tool/MCP 参数或结果、凭证、原始错误 message/stack；
- 普通 Session create/close 成功不逐条记录，避免高频噪声。

## 生命周期与特殊说明

- 应用共享 Host 的关闭顺序是 Composition/Instance → Host → 应用 Hub；私有 Host 由 Composition 自动关闭。
- 子 Agent 的 Coding Composition 共享父级 Host 和 `agentId`，但创建独立 Instance；这只是资源复用，不改变其产品层主从语义。
- `agentRuntime.instanceConfiguration` 会作为 `unknown` 传入 Definition；execution bridge 的标准 Definition 不把它当作
  Coding 产品配置入口。
- 相同 `agentId` 只能由一个 Source 拥有；更新时保持 `source.id`，增加 `source.revision`。
- Definition transform 必须保留仍需使用的 `modelBindingProvider`、Session Extensions 和释放合同；完全替换返回值意味着调用者
  接管这些通用合同的正确性。
- Observation 是只读且失败隔离的。授权、重试、修改 Prompt 或阻止 Tool 必须使用 Tool Policy、Feature、Interceptor 或
  Session Extension，不能在日志 Adapter 中实现。
