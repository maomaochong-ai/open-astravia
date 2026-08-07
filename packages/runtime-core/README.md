# @vetta/runtime-core

Runtime contracts and host integration for Agent sessions.

The root entry exposes the production `RuntimeHost`, the Kernel-backed Runtime
Session implementation, and stable host contracts. Kernel primitives remain
available through the explicit `@vetta/runtime-core/kernel` entry.

## What It Owns

- session lifecycle facade (`createSession`, `prompt`, `continue`, `abort`)
- runtime-safe event contract for hosts
- state snapshots and session history listing
- isolated Session state machine, Typed Turn Pipeline and Feature Compiler under `./kernel`
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
- backend-provided Background Work and Todo controllers with runtime-owned host snapshots
- backend-provided Session Configuration Controller for input queue modes, plugin runtime configuration and agent mode
- process-level Session Catalog, direct file history reader and shared model controller ports
- runtime-owned tool execution and policy contracts

## What It Does Not Own

- provider implementations
- terminal UI
- Electron IPC wiring
- business-specific APIs or permissions

## Who Depends On It

- [packages/cli-app](../cli-app)
- [packages/desktop-app](../desktop-app)

## Main Exports

- `RuntimeHost`
- `RuntimeHostSessionBackend` and `KernelRuntimeSessionBackend` for composition-root session creation
- `RuntimeSessionCreateRequest` for backend-neutral creation without SessionManager, custom tools or ModelRegistry
- `RuntimeSessionTurnControl`, `RuntimeSessionEventStream` and `RuntimeSessionStateReader` core host ports
- `RuntimeSessionIdentityLifecycle` and `RuntimeSessionHistoryReader` for identity, disposal and history projection
- `RuntimeSessionHistoryController` for guarded history mutation and live-session naming
- `RuntimeSessionModelController` for model selection and model-related write configuration
- `RuntimeSessionModelView` for current/available models and credential lookup without exposing the registry
- `RuntimeSessionHostInteraction` for rebinding confirmation and sandbox-grant capabilities
- `RuntimeSessionWorkspaceView` and `RuntimeSessionExecutionController` for cwd lookup, busy-state guards and mode changes
- `RuntimeSessionBackgroundWorkController` and `RuntimeSessionTodoController` for background/subagent/todo host state
- `RuntimeSessionConfigurationController` for dynamic session configuration without exposing the legacy session
- `RuntimeSessionCatalog`, `RuntimeSessionFileHistoryReader` and `RuntimeSharedModelController` for process-level services
- `RuntimeHostSessionAssembly` and `RuntimeHostSessionBackend` for explicit port-only composition-root capability delivery
- `RuntimeSession` and `RuntimeSessionCoreAssembly` for Kernel-backed session execution and host capabilities
- `RuntimeSessionProjection` for synchronous Conversation Document and host state projection
- `RuntimeModelRuntime` and `RuntimeModel` for shared Controller/View/State/Turn model state
- `@vetta/runtime-core/conversation` for the tree-shaped history read model, reader port and host history projection
- `resumeAgentSession` and `ConversationRecoveryPolicy` for recovery without model or tool replay
- `RuntimeSessionObservationEvent` and Kernel-to-`SessionEvent` adapters
- session event and state contracts from `src/contracts.ts`
- shared runtime error helpers
- `@vetta/runtime-core/kernel` for the new `AgentSession`, `TurnPipeline`,
  `FeatureCompiler`, `AtomicRuntimeSnapshotProvider`, `AgentCoreTurnEngine` and
  Port contracts
