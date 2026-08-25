# 自定义 Agent 指南

本文说明如何基于 `@vetta/runtime-core` 创建、发布、运行和动态更新多个平级主 Agent。这里的 Agent
不是由某个主 Agent 派发的子 Agent；每个 Agent 都有独立的 Definition、revision、Instance、Session、Prompt、
Tool、MCP、模型绑定、扩展与观测作用域。

## 先理解四层生命周期

```text
RuntimeAgentRegistry
└── RuntimeAgentDefinition revision      进程级、不可变、可动态替换
    └── RuntimeAgentInstance             Agent 实例级资源，例如租户连接或共享目录
        └── RuntimeAgentSession          会话级资源，例如 Prompt、Tool、MCP 状态和模型选择
            └── RuntimeSnapshot lease    单个 Turn 使用的不可变能力代际
```

| 层级 | 适合拥有的内容 | 释放时机 |
| --- | --- | --- |
| Definition revision | 工厂、revision 共享资源 | revision 不再可用且最后一个 lease 释放后 |
| Instance | 租户/工作区连接、实例级缓存 | Instance 关闭后 |
| Session | 会话 Tool/MCP 状态、Session Extension | Session 关闭后 |
| Turn Snapshot | 本 Turn 的 Prompt、Tool handler、模型绑定 | Turn lease 释放后 |

`RuntimeAgentHost` 是多 Agent 控制面和 `RuntimeSnapshotProvider` 宿主，不直接提供 `prompt()` 聊天接口。
应用仍需把 `RuntimeAgentSession` 交给 Kernel Turn Engine、自己的执行器，或像 Coding Agent 一样在产品层包装成完整
Session facade。这样基础注册表不会绑定某一种业务会话协议。

## 最小可用流程

下面的 Agent 只有一段系统提示词，但已经具备 revision、Instance、Session、模型绑定、默认缓存前缀和生命周期管理。

```ts
import {
  defineRuntimeAgent,
  RuntimeAgentHost,
  type RuntimeAgentDefinition,
} from "@vetta/runtime-core/agents";
import {
  PassthroughContextStrategy,
  resolveModelCallFrame,
  type RuntimeTurnModelBindingProvider,
} from "@vetta/runtime-core/kernel";

function createReviewerAgent(
  modelBindingProvider: RuntimeTurnModelBindingProvider,
): RuntimeAgentDefinition {
  return defineRuntimeAgent({
    id: "reviewer",

    createInstance() {
      return {
        createSession() {
          return {
            capabilities: {
              instructions: [
                {
                  id: "reviewer.base",
                  content: "Review the proposed change and report concrete risks.",
                  priority: 0,
                },
              ],
              features: [],
              contextStrategy: new PassthroughContextStrategy(),
              toolPolicy: { authorize: async () => false },
              tokenBudget: 32_000,
              reservedOutputTokens: 4_000,
            },
            modelBindingProvider,
          };
        },
      };
    },
  });
}

const host = new RuntimeAgentHost();
const reviewer = createReviewerAgent(modelBindingProvider);

host.registry.upsert({
  source: { id: "code", revision: "reviewer-1" },
  definition: reviewer,
});

const instance = await host.createInstance({
  agentId: "reviewer",
  instanceId: "reviewer-instance-1",
});
const session = await instance.createSession({
  sessionId: "reviewer-session-1",
});

const signal = new AbortController().signal;
const lease = await session.acquire({
  sessionId: session.id,
  operationId: "preview-1",
  reason: "preview",
  signal,
});

try {
  const frame = await resolveModelCallFrame(lease.snapshot, {
    sessionId: session.id,
    turnId: "turn-1",
    signal,
  });
  console.log(frame.instructions[0]?.content);
  console.log(frame.systemPromptStableLength); // 默认等于完整 system prompt 长度
} finally {
  await lease.release();
  await host.close();
}
```

`modelBindingProvider` 由宿主提供，它在 Turn admission 时返回不可变的模型、reasoning 与可选 credential binding。
真实模型对象和凭证不应写进配置文件、日志或 Observation。

后续代码块是在这个最小示例上的增量片段。`parseXxx()`、`createTenantClient()`、`safeTelemetry` 等未从 Runtime
导出的名称代表宿主或产品需要实现的校验器、平台连接和 Adapter，并不是隐藏的 Runtime API。

## 同时运行多个平级主 Agent

同一个 Host 可以注册完全不同的 Agent。它们只共享 Registry 和抽象观测出口，不共享 Prompt、Tool、Session 状态或
模型绑定：

```ts
host.registry.upsert({
  source: { id: "code", revision: "writer-1" },
  definition: createWriterAgent(writerModelBindingProvider),
});
host.registry.upsert({
  source: { id: "code", revision: "reviewer-1" },
  definition: createReviewerAgent(reviewerModelBindingProvider),
});

const writerInstance = await host.createInstance({ agentId: "writer" });
const reviewerInstance = await host.createInstance({ agentId: "reviewer" });

const writerSession = await writerInstance.createSession();
const reviewerSession = await reviewerInstance.createSession();
```

这里没有“主 Agent 派发子 Agent”的关系。应用根据路由、用户选择、租户策略或 API 参数选择 `agentId`；如果需要
Agent 间协作，应由更上层的编排产品显式连接它们，而不是让 Registry 隐式决定调用关系。

## 自定义 Instance 与 Session 配置

代码配置和文件配置最终都会作为 `unknown` 进入 Definition。Runtime Core 不解释业务字段；Agent 必须在首次进入
自身边界时校验，不能直接断言类型。

```ts
interface ReviewerInstanceConfig {
  readonly tenantId: string;
  readonly allowedTools: readonly string[];
}

interface ReviewerSessionConfig {
  readonly language: "zh-CN" | "en-US";
  readonly strict: boolean;
}

const reviewer = defineRuntimeAgent({
  id: "reviewer",

  createInstance({ configuration, signal }) {
    signal.throwIfAborted();
    const instanceConfig = parseReviewerInstanceConfig(configuration);
    const tenantClient = createTenantClient(instanceConfig.tenantId);

    return {
      createSession({ configuration, observationPublisher, signal: sessionSignal }) {
        sessionSignal.throwIfAborted();
        const sessionConfig = parseReviewerSessionConfig(configuration);

        return {
          capabilities: {
            instructions: [
              {
                id: "reviewer.base",
                content: renderReviewerPrompt(sessionConfig),
                priority: 0,
              },
            ],
            features: [createReviewToolFeature(tenantClient, observationPublisher)],
            contextStrategy: new PassthroughContextStrategy(),
            toolPolicy: {
              authorize: async ({ toolName }) => instanceConfig.allowedTools.includes(toolName),
            },
            tokenBudget: 32_000,
            reservedOutputTokens: 4_000,
          },
          modelBindingProvider,
        };
      },

      dispose: () => tenantClient.close(),
    };
  },
});

const instance = await host.createInstance({
  agentId: "reviewer",
  configuration: {
    tenantId: "tenant-a",
    allowedTools: ["review_diff"],
  },
});

const session = await instance.createSession({
  configuration: { language: "zh-CN", strict: true },
});
```

建议把实例级配置用于租户、工作区或共享连接，把会话级配置用于 Prompt 选择、工具可见性和本会话模型策略。
配置校验失败应直接拒绝创建，Host 会回滚本次已经取得的资源。

## 自定义 Tool

静态 Tool 通常由 Feature 贡献。Feature 可以持有资源，并在 Snapshot generation 退休后由 Runtime 释放。

```ts
import type {
  AgentFeatureDefinition,
  RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";

const currentTimeTool: RuntimeToolDefinition = {
  name: "current_time",
  label: "Current time",
  description: "Return the current UTC time.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute({ signal }) {
    signal.throwIfAborted();
    return {
      content: [{ type: "text", text: new Date().toISOString() }],
    };
  },
};

const currentTimeFeature: AgentFeatureDefinition = {
  id: "tool.current-time",
  async prepare({ signal }) {
    signal.throwIfAborted();
    return {
      async contribute() {
        return { tools: [currentTimeTool] };
      },
      async dispose() {},
    };
  },
};
```

把 `currentTimeFeature` 放进 `capabilities.features`，并在 `toolPolicy.authorize()` 中明确允许
`current_time`。Tool Schema、handler 和 Policy 必须来自同一个 Snapshot generation；不要在 handler 内读取一个
没有 Turn lease 保护的全局“最新配置”。需要运行时换 Tool 时，发布新 Agent revision 或使用具有自身稳定 binding
合同的 Tool Registry。

## 接入 MCP

Runtime Core 不认识 MCP server 配置或 transport。`@vetta/runtime-mcp` 把 MCP Tool 投影成通用
`RuntimeToolDefinition`；具体 stdio/HTTP 连接、OAuth、进程和文件读取由平台宿主实现。

下面展示 Session 内的基本组合方式。`mcpSource` 是宿主创建的 `McpRuntimeToolSource`，不是配置文件本身：

```ts
import {
  createMcpRuntimeToolSynchronizer,
  renderMcpToolsInstruction,
  type McpRuntimeToolSource,
} from "@vetta/runtime-mcp";
import type {
  AgentFeatureDefinition,
  RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { RuntimeObservationPublisher } from "@vetta/runtime-core/observation";

function createMcpFeature(
  mcpSource: McpRuntimeToolSource,
  observationPublisher: RuntimeObservationPublisher,
): AgentFeatureDefinition {
  const tools = new Map<string, RuntimeToolDefinition>();
  const synchronizer = createMcpRuntimeToolSynchronizer(
    mcpSource,
    {
      register: (tool) => tools.set(tool.name, tool),
      unregister: (toolName) => tools.delete(toolName),
    },
    { observationPublisher },
  );

  return {
    id: "mcp.tools",
    async prepare() {
      return {
        async contribute() {
          return {
            modelCallProviders: [
              {
                id: "mcp.tools.refresh",
                async contribute({ signal }) {
                  signal.throwIfAborted();
                  const snapshot = await synchronizer.refresh();
                  const content = renderMcpToolsInstruction(snapshot.tools, false);
                  return {
                    instructions: content
                      ? [{ id: "mcp.index", content, priority: 500 }]
                      : [],
                    tools: [...tools.values()],
                  };
                },
              },
            ],
          };
        },
        async dispose() {
          synchronizer.dispose();
        },
      };
    },
  };
}
```

这个例子在每次模型调用前刷新 MCP inventory，因此 `mcp.index` 默认属于 `volatile` Prompt 尾段。若 MCP
inventory 在整个 Snapshot generation 中被冻结，可以在 Feature 编译期产生 Instruction；只有能够证明跨 Turn
逐字不变时，才显式声明 `cacheability: "stable"`。

当 Tool 数量较多时，应使用 `createMcpDeferredToolController()` 做渐进披露，而不是一次把所有 Schema 放进模型上下文。
MCP 凭证、server fingerprint、Tool 参数和结果不得进入默认 Observation。

## 配置文件创建 Agent

配置文件不能安全地序列化函数、Tool handler、模型对象、MCP 连接或 Session Extension。推荐只保存数据和受控
组件引用，再由宿主解析为完整 Definition：

```json
{
  "revision": "2026-08-25.1",
  "agents": [
    {
      "id": "reviewer",
      "kind": "prompt-agent",
      "prompt": "Review this change and list concrete risks.",
      "modelRef": "review-model",
      "toolRefs": ["review.diff"],
      "mcpRefs": ["github-readonly"]
    }
  ]
}
```

宿主 Source 负责 I/O、Schema 校验和引用解析，Runtime 只接收完整快照：

```ts
import {
  RuntimeAgentDefinitionSynchronizer,
  type RuntimeAgentDefinitionSource,
} from "@vetta/runtime-core/agents";

const source: RuntimeAgentDefinitionSource = {
  id: "workspace-config",

  async load(signal) {
    const text = await workspaceFiles.readAgentConfig(signal);
    const raw: unknown = JSON.parse(text);
    const config = parseAgentConfigFile(raw); // 首次进入领域时完成严格校验

    return {
      revision: config.revision,
      definitions: config.agents.map((agent) =>
        resolveConfiguredAgent(agent, {
          models: trustedModelComponents,
          tools: trustedToolComponents,
          mcpSources: trustedMcpComponents,
        }),
      ),
    };
  },

  subscribe(listener) {
    return workspaceFiles.onAgentConfigChanged(listener);
  },
};

const synchronizer = new RuntimeAgentDefinitionSynchronizer({
  source,
  registry: host.registry,
});

await synchronizer.start();
```

Source Snapshot 是全量而不是增量：新快照中删除某个 Agent，会原子移除该 Source 拥有的 Agent。任一 Definition
非法或与其它 Source 的 `agentId` 冲突时，整次发布失败并保留 last-known-good。每次实际内容变化必须生成新的
`revision`；相同 revision 会被视为未变化。

文件、Plugin、数据库和远端控制面都应复用 `RuntimeAgentDefinitionSource`，不要分别建立四套 Registry。

## 运行时新增、更新、停用与删除

### 代码动态新增或更新

```ts
host.registry.upsert({
  source: { id: "code", revision: "reviewer-2" },
  definition: createReviewerAgentV2(modelBindingProvider),
});
```

每次成功 `upsert` 都生成不可变 Runtime revision：

- 新 Instance 立即使用新 revision；
- 已存在的 Instance 和 Session 默认继续使用旧 revision；
- 已经 acquire 的 Turn Snapshot 永远不会被替换；
- 旧 revision 在最后一个 lease 释放前不会 dispose。

### 让已有 Session 从下一 Turn 更新

```ts
const result = await session.rolloutToLatest();
console.log(result.status, result.revisionId);
```

rollout 会用原 Instance/Session configuration 重新创建新 revision 的资源图，再原子发布新的 Snapshot。正在运行的
Turn 不受影响，下一次 acquire 才看到新 Prompt、Tool、模型绑定和缓存 generation。

当前 rollout 不允许改变 `sessionExtensions` 的 ID 拓扑。需要新增或删除 Session Extension 时，应创建新 Session；
这是为了避免把已经存在的 Session 状态和 endpoint 在运行中变成另一套结构。

### 停用与删除

```ts
host.registry.retire("reviewer"); // 禁止新 acquire，但保留目录项和已有 lease
host.registry.remove("reviewer"); // 删除目录项，已有 lease 仍可安全结束
```

普通更新、retire 和 remove 都不是紧急撤权。若安全事件要求让在途 Tool 或 credential 立即失效，必须使用 Tool/credential
自己的 hard-revocation 合同，不能依赖普通 revision retirement。

## Prompt、Composer 与缓存前缀

基础 Agent 不需要自定义 Composer：

- `capabilities.instructions` 和 Feature 编译期 Instruction 默认 `stable`；
- 模型调用期 Contribution 默认 `volatile`；
- Runtime 自动计算开头连续的稳定缓存前缀；
- Runtime 不会为了扩大缓存前缀改变 `priority + id` 顺序。

```ts
instructions: [
  { id: "base", content: "Stable base prompt", priority: 0 },
  {
    id: "tenant-policy",
    content: renderedTenantPolicy,
    priority: 100,
    cacheability: "stable", // 声明者保证当前 Snapshot generation 内逐字不变
  },
]
```

只有需要把多个 Instruction 编译成产品结构化 Prompt、重写 Tool 面或输出精确 block spans 时，才实现
`ModelCallFrameComposer`。Composer 是最终编译器，不是可串联 middleware；一个 capability definition 最多一个。
Composer 显式返回的 `systemPromptStableLength` 与 block layout 优先，非法偏移会降级为不缓存并发布 warning，
不会中断模型调用。

下面的 Composer 把产品稳定部分和调用级动态部分编译成两个最终 block，并用通用 cacheability 请求 Runtime 自动
计算偏移：

```ts
modelCallFrameComposer: {
  async compose({ frame, signal }) {
    signal.throwIfAborted();
    const stablePrompt = renderStableProductPrompt(frame);
    const dynamicTail = renderDynamicProductTail(frame);

    return {
      instructions: [
        {
          id: "product.stable",
          content: stablePrompt,
          priority: 0,
          cacheability: "stable",
        },
        ...(dynamicTail
          ? [{
              id: "product.dynamic",
              content: dynamicTail,
              priority: 100,
              cacheability: "volatile" as const,
            }]
          : []),
      ],
      tools: frame.tools,
    };
  },
},
```

如果 Composer 自己返回 `systemPromptStableLength` 和 `promptCacheSystemPromptBlocks`，这些元数据会覆盖自动布局；
block offset 必须对应最终 Instruction 以 `\n\n` 拼接后的确切字符位置。

`Profile`、Persona、Mode 都不是 Runtime Core 字段。业务层可以定义这些概念，但必须在创建 Definition 前解析成普通
Instruction、Feature、Policy 或 Extension。

## 观测自定义 Agent

最简单的宿主仍可直接向 Host 注入一个抽象 Port。JSONL、OTLP、Langfuse、Metrics 或 UI 面板都是 Port 的具体实现：

```ts
import { RuntimeAgentHost } from "@vetta/runtime-core/agents";
import type { RuntimeObservationPort } from "@vetta/runtime-core/observation";

const observationPort: RuntimeObservationPort = {
  record(record) {
    safeTelemetry.enqueue({
      event: record.token.id,
      level: record.token.level,
      context: record.context,
      payload: record.payload,
      timestamp: record.timestamp,
    });
  },
  flush: () => safeTelemetry.flush(),
};

const host = new RuntimeAgentHost({ observationPort });
```

需要模块独立观测、动态 Adapter 或多层汇聚时，使用开箱即用的 `RuntimeObservationHub`：

```ts
import { RuntimeAgentHost } from "@vetta/runtime-core/agents";
import { RuntimeObservationHub } from "@vetta/runtime-core/observation";

const agentHub = new RuntimeObservationHub({ maxPendingRecords: 1_000 });
const localRoute = agentHub.attach(localMemoryPort, {
  id: "reviewer.local-memory",
  domains: ["review.index"],
});

const host = new RuntimeAgentHost({
  observationPublisher: agentHub.publisher({ traceId: requestTraceId }),
});

// Agent 已运行时也可让未来事件汇入应用级 Hub；不改变它的能力 revision 或在途 Turn。
const applicationRoute = agentHub.attach(applicationHub, { id: "application" });

// 只停止未来投递；已经发布的记录不会重放，Adapter 的外部资源仍由其创建者释放。
applicationRoute.detach();
localRoute.detach();
await host.close();
await agentHub.close();
```

如果父子关系在组合时已经确定，也可以 `new RuntimeObservationHub({ parent: applicationHub })`。子 Hub 的 record 会
原样进入父级，`timestamp` 和 identity 不会被重新生成；关闭子 Hub 不关闭父级。上层可统一注册 Adapter，模块仍可保留
自己的本地 Adapter。路由支持 `domains`、`levels` 和只读 `predicate`，Hub 的 `snapshot()` 可查看交付、过滤、失败、
丢弃和在途计数。

如果模块拿到的是已经绑定 Agent/revision/instance identity 的 Publisher，而不是裸 Port，应使用
`createRuntimeObservationPublisherPort(scopedPublisher)` 作为子 Hub 的 parent。它通过 Publisher 的 `forward()` 合并
父级 identity，同时保留子记录的 token、payload 与 timestamp。不要用普通 `publisher.record()` 手工重发已有 record，
否则会生成新的 timestamp。Publisher 应由 `createRuntimeObservationPublisher()` 或 Runtime Agent Host 创建；自定义实现
必须同时实现 `forward()` 的无损记录转发语义。

Definition、Instance 和 Session 工厂收到的 `observationPublisher` 已绑定正确的
`agentId/revisionId/instanceId/sessionId`，自定义能力可以定义自己的安全事件：

```ts
import { defineRuntimeObservation } from "@vetta/runtime-core/observation";

const REVIEW_INDEX_OBSERVATION = defineRuntimeObservation<{
  readonly phase: "started" | "completed";
  readonly itemCount?: number;
}>("review.index", "refresh");

observationPublisher.record(REVIEW_INDEX_OBSERVATION, {
  phase: "completed",
  itemCount: resultCount,
});
```

Observation 是失败隔离的只读出口，不得用于授权、修改 Prompt、重试或阻止 Tool 执行。这些行为分别进入
Tool Policy、Composer、显式重试策略或领域 Interceptor。自定义 payload 的设计者负责确保不包含 Prompt、用户内容、
Tool 参数/结果、凭证、错误 message 或 stack。

现有 Session 业务事件不能原样写入 Hub；使用 `publishRuntimeSessionObservation()` 时只会得到
`runtime.session.event` 的安全摘要。日志与 Trace 的现成 Adapter 位于 `@vetta/runtime-telemetry`：

```ts
import {
  createRuntimeObservationLoggerPort,
  createRuntimeObservationTracerPort,
} from "@vetta/runtime-telemetry";

applicationHub.attach(createRuntimeObservationLoggerPort({ logger }), {
  id: "structured-log",
  levels: ["info", "warning", "error"],
});
applicationHub.attach(createRuntimeObservationTracerPort({ tracer }), {
  id: "trace-events",
});
```

Tracer Adapter 产生的是平面 event；模型调用、generation 和 Tool 的原生父子 Span 继续使用执行层 `tracer`。两者可通过
Observation context 中的 Session/Turn/Tool/Trace identity 关联，但不应把平面事件冒充原生 Span。

## Coding Agent 如何接入

Coding Agent 是基于同一基座的复杂产品 Agent，不是 Runtime Core 的特殊模式。产品包通过
`createCodingAgentExecutionRuntimeDefinition()` 为生产 Composition 创建普通 `RuntimeAgentDefinition`。每个
`createCodingAgentRuntimeComposition()` 默认拥有私有 Host；Desktop 等应用也可通过
`publishCodingAgentExecutionRuntimeDefinition()` 向共享 Host 发布，再把 Host 注入多个 Composition。产品边界负责：

- Coding Prompt 与产品 Profile 的解析；
- Coding Tool Catalog 与权限策略；
- MCP server、渐进披露和 Plugin MCP；
- 模型选择、凭证、Context Strategy、压缩与 continuation；
- Session Extension 和完整 SDK/Desktop/CLI Session facade。

产品装配只交付未编译的通用 Session Definition，`RuntimeAgentSession` 是能力编译和 Snapshot Provider 的唯一事实源。
`createCodingAgentRuntimeDefinition()` 仍用于调用者自行提供完整 Instance/Session assembler 的较低层场景，不是默认生产
Composition 的桥接函数。实现细节与可运行接线见
[《Coding Agent 与多主 Agent 基座》](../../coding-agent/docs/runtime-agent-base.md)。

因此其它产品可以采用相同模式：在自己的包中提供 `createXxxRuntimeDefinition()`，只把最终通用能力交给 Runtime，
不要把业务 Profile 或固定场景加入基座合同。

## 常见使用案例

| 场景 | 推荐组合 |
| --- | --- |
| 简单问答/分类 Agent | 静态 Instruction + 模型绑定；不需要 Composer |
| 不同租户拥有不同 Tool | Instance configuration + Tool Feature + Tool Policy |
| 每个会话使用不同语言/Prompt | Session configuration，在 `createSession()` 内解析 |
| 动态知识检索 | Model Call Contribution Provider；动态 Instruction 默认 volatile |
| 多个 MCP server | 宿主创建 MCP Source，Session Feature 投影成 Tool；数量多时渐进披露 |
| 文件或远端动态配置 | Definition Source + Synchronizer + last-known-good |
| 在线升级已有会话 | 发布新 revision，再显式 `session.rolloutToLatest()` |
| OTLP/JSONL/UI 诊断 | 模块 Hub + 应用 Hub + 一个或多个 `RuntimeObservationPort` Adapter |
| Coding 类复杂产品 | 产品包 Definition Adapter + 产品 Session facade |

## 特殊说明与检查清单

- Agent 是平级主 Agent；Registry 不表达主从或任务派发关系。
- `agentId` 在所有 Source 之间唯一。需要覆盖时应在上层显式合并，而不是依赖隐藏优先级。
- 配置文件只保存数据和受控引用，不保存函数、密钥、模型对象或连接实例。
- 所有外部配置、Plugin、Skill 和 MCP 输入都在首次进入领域边界时校验。
- Definition/Instance/Session 各自只释放自己拥有的资源；不要让多个层级重复关闭同一连接。
- `dispose()`、Host close 和 revision lease release 应按幂等方式使用；Host 会负责逆序回滚和聚合释放错误。
- 动态更新默认不影响旧 Instance、旧 Session 和在途 Turn；需要迁移时显式 rollout。
- rollout 不能改变 Session Extension ID 拓扑；结构变化创建新 Session。
- 缓存优化不能改变 Prompt 顺序。无法证明跨 Turn 不变的内容默认 volatile。
- Observation 不是通用 middleware；任何会改变行为的扩展必须进入明确的领域合同。
- `RuntimeAgentHost` 不等于完整聊天 Session API；产品执行层仍需负责 Conversation、Turn Engine 和用户协议。

长期架构约束见：

- [ADR-0079：Runtime Core 多主 Agent Definition Registry](../../../docs/adr/0079-runtime-core-multi-agent-definition-registry.md)
- [ADR-0080：Runtime 统一可观测端口](../../../docs/adr/0080-runtime-observation-port.md)
- [ADR-0081：Runtime 默认 Prompt 缓存布局](../../../docs/adr/0081-runtime-default-prompt-cache-layout.md)
- [ADR-0082：分层 Runtime Observation Hub](../../../docs/adr/0082-hierarchical-runtime-observation-hub.md)
