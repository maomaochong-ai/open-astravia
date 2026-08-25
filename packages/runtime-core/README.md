# @vetta/runtime-core

Runtime contracts and host integration for Agent sessions.

The root entry exposes the production `RuntimeHost`, the Kernel-backed Runtime
Session implementation, and stable host contracts. Kernel primitives remain
available through the explicit `@vetta/runtime-core/kernel` entry.

`runtime-core` and the `runtime-storage`, `runtime-tools` and `runtime-mcp`
protocol packages form the portable Runtime boundary. Concrete filesystem,
process, persistence and transport behavior is supplied by a platform
implementation such as `runtime-node`; the current `coding-agent` product
composition is Node-oriented and is not part of this portable boundary.

## What It Owns

- session lifecycle facade (`createSession`, `prompt`, `continue`, `abort`)
- runtime-safe event contract for hosts
- product-neutral `session.extension` observations with typed in-process tokens and opaque host payloads
- state snapshots and session history listing
- isolated Session state machine, Typed Turn Pipeline and Feature Compiler under `./kernel`
- process-level peer Agent Definition registry with immutable revisions, leases and dynamic Source synchronization under `./agents`
- peer Agent Instance/Session routing with isolated capability compilation, Session Extensions and explicit next-Turn rollout
- type-safe, failure-isolated observation ports and scoped Agent/Session/Turn identity under `./observation`
- acquire/release Runtime Snapshot lifecycle with atomic Feature-topology switching
- per-model-call prompt and tool materialization through Model Call Contribution Providers
- `AgentCoreTurnEngine` adapter for the `@vetta/agent-core` model and tool loop
- session-owned steering/follow-up queues with configurable consumption modes
- Kernel-backed Runtime Session for prompt/continue/abort, mapped events and repository-backed state
- synchronous Runtime message/state projection with genuine lifecycle, workspace and core session ports
- runtime-owned Conversation Document and synchronous Runtime history projection
- explicit create/resume paths with fail-closed interrupted Turn recovery and optimistic versioning
- narrow RuntimeHost Turn Control, Event Stream and State Read ports implemented by the canonical Kernel backend
- port-only RuntimeHost session assemblies with no raw product session handle
- runtime-owned, backend-neutral session creation requests
- backend-provided Session Identity/Lifecycle and read-only History ports
- backend-provided History Controller for guarded edits, branches, forks and session naming
- backend-provided Model Controller for selection, thinking level and session-scoped auth refresh
- backend-provided read-only Model View for input capabilities and peripheral model selection
- Runtime Session model fact source with abstract catalog/credential ports and immutable per-Turn model binding
- backend-provided Host Interaction binding without exposing product extension UI protocols
- backend-provided Workspace View and Execution Controller without exposing SessionManager or custom tool types
- backend-provided Background Work controller plus an optional, typed Session Extension host bridge
- backend-provided Session Configuration Controller for input queue modes, plugin runtime configuration and agent mode
- process-level Session Catalog, direct file history reader and shared model controller ports
- runtime-owned tool execution and policy contracts
- host ports for path normalization, directory preparation, queue snapshot persistence and sandbox grant storage

## What It Does Not Own

- provider implementations
- terminal UI
- Electron IPC wiring
- business-specific APIs or permissions
- filesystem, operating-system path policy, AsyncLocalStorage or other Node.js platform implementations

## Who Depends On It

- [packages/runtime-node](../runtime-node)
- [packages/coding-agent](../coding-agent)
- [packages/runtime-desktop](../runtime-desktop)
- [apps/cli-host](../cli-host) and [apps/desktop](../desktop)

## Main Exports

- `RuntimeHost`
- `@vetta/runtime-core/agents` for `RuntimeAgentDefinition`, `RuntimeAgentRegistry`, `RuntimeAgentHost`, Instance/Session routing, revision leases and Source synchronization
- `@vetta/runtime-core/observation` for domain-owned tokens, scoped publishers, safe failure projection and arbitrary telemetry adapters
- `RuntimeHostSessionBackend` and `KernelRuntimeSessionBackend` for composition-root session creation
- `RuntimeSessionCreateRequest` for backend-neutral creation without SessionManager, custom tools or ModelRegistry
- `RuntimeSessionTurnControl`, `RuntimeSessionEventStream` and `RuntimeSessionStateReader` core host ports
- `RuntimeSessionIdentityLifecycle` and `RuntimeSessionHistoryReader` for host-owned identity/location facts, disposal and history projection
- `RuntimeSessionHistoryController` for guarded history mutation and live-session naming
- `RuntimeSessionModelController` for model selection and model-related write configuration
- `RuntimeSessionModelView` for current/available models and credential lookup without exposing the registry
- `RuntimeSessionHostInteraction` for rebinding confirmation and sandbox-grant capabilities
- `RuntimeSessionWorkspaceView` and `RuntimeSessionExecutionController` for cwd lookup, busy-state guards and mode changes
- `RuntimeSessionBackgroundWorkController` for background/subagent host state
- `RuntimeSessionExtensionHost` and typed Session Extension endpoint tokens for product-owned host commands
- `SessionExtensionObservationToken` and `sessionExtensionObservation()` for product-owned host observations
- `SessionExtensionInitialObservationSource` for extension-owned late-subscriber state replay
- `RuntimeSessionConfigurationController` for dynamic session configuration without exposing the legacy session
- `RuntimeSessionCatalog`, `RuntimeSessionFileHistoryReader` and `RuntimeSharedModelController` for process-level services
- `RuntimeHostSessionAssembly` and `RuntimeHostSessionBackend` for explicit port-only composition-root capability delivery
- `RuntimeSession` and `RuntimeSessionCoreAssembly` for Kernel-backed session execution and host capabilities
- `RuntimeSessionProjection` for synchronous Conversation Document and host state projection
- `RuntimeModelRuntime` and `RuntimeModel` for shared Controller/View/State/Turn model state
- `@vetta/runtime-core/conversation` for the tree-shaped history read model, reader port and host history projection
- `resumeAgentSession` and `ConversationRecoveryPolicy` for recovery without model or tool replay
- `RuntimeSessionObservationEvent` and Kernel-to-`SessionEvent` adapters, including provider/model cache observability on `usage.update`
- generation and agent tracing projections for prompt-cache hit rate, write rate, and observation coverage
- session event and state contracts from `src/contracts.ts`
- shared runtime error helpers
- `@vetta/runtime-core/kernel` for the new `AgentSession`, `TurnPipeline`,
  `RuntimeCapabilityDefinition`, `FeatureCompiler`, `RuntimeCapabilityComposition`,
  `AtomicRuntimeSnapshotProvider`, `AgentCoreTurnEngine` and Port contracts

## Multi-Agent Definition Example

每个 Definition 是平级主 Agent，不是由某个主 Agent 派发的子任务。代码、配置文件、Plugin、数据库或远端控制面
最终都发布同一种 Definition revision：

```ts
import { defineRuntimeAgent, RuntimeAgentHost } from "@vetta/runtime-core/agents";

const reviewer = defineRuntimeAgent({
  id: "reviewer",
  createInstance: ({ observationPublisher }) => ({
    createSession: ({ observationPublisher: sessionObservations }) => ({
      capabilities: {
        instructions: [{ id: "reviewer.base", content: "Review the change.", priority: 0 }],
        features: [reviewTools, reviewMcp],
        contextStrategy,
        toolPolicy,
        tokenBudget: 32_000,
        reservedOutputTokens: 4_000,
        observationPublisher: sessionObservations,
      },
      modelBindingProvider,
      sessionExtensions: [reviewStateExtension],
    }),
  }),
});

const host = new RuntimeAgentHost({ observationPort });
host.registry.upsert({ source: { id: "code", revision: "2026-08-25.1" }, definition: reviewer });
```

后续 `upsert` 生成新 revision：新 Instance 获取新定义，已经运行的 Instance/Session 保持旧 revision；只有显式
`session.rolloutToLatest()` 才从下一 Turn 原子切换可热换能力。配置文件不能直接序列化 Tool handler 或 MCP
连接，宿主应先完成 Schema 校验和组件引用解析，再通过 `RuntimeAgentDefinitionSource` 发布完整定义；Runtime
Core 不读取文件或动态加载模块。

## Extension and Observation Boundaries

| 变化类型 | 使用边界 |
| --- | --- |
| Prompt、Tool、MCP、上下文与模型调用级动态能力 | `RuntimeCapabilityDefinition`、Feature 与 Contribution Provider |
| Tool 授权或会改变行为的决策 | Tool Policy 或领域 Typed Interceptor |
| Session 状态、服务、端点、持久化参与者与 continuation | Session Extension |
| Definition 的代码/文件/Plugin/远端动态发布 | Definition Source + Registry revision |
| 日志、Trace、Metrics、JSONL 或 UI 诊断 | 只读 `RuntimeObservationPort` |

基座不提供可任意修改共享上下文的通用 `next()` middleware。只读 Observer 必须失败隔离；会改变执行结果的逻辑
必须进入显式 Policy、Interceptor、Feature 或 Extension 合同。`Profile`、Persona 和 Mode 属于具体产品，产品在
创建 Definition 前把它们解析为普通 Instruction/Feature，不能向 Runtime Agent 合同下传。
