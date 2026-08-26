/**
 * RuntimeHost 模块入口。
 *
 * 目录职责：
 * - runtime-host.ts      会话生命周期与编排（SessionFacade）
 * - session-events.ts    旧事件 → Session Observation → SessionEvent 映射
 * - kernel-session-events.ts      KernelEvent → SessionEvent 映射
 * - history.ts           会话历史 / 分支 / turn timing 解析
 * - peripheral-tasks.ts  自动标题、输入预测（轻量 LLM + 失败轮转）
 * - plugin-debug.ts      插件调试日志
 * - types.ts             共享类型
 */

export {
	RuntimeActiveSessionEventRelay,
	type RuntimeActiveSessionEventRelayOptions,
	type RuntimeActiveSessionListenerKind,
} from "./active-session-event-relay.js";
export {
	RuntimeActiveSessionHost,
	waitForRuntimeSessionIdle,
} from "./active-session-host.js";
export type {
	RuntimeActiveSessionCreateOptions,
	RuntimeActiveSessionEndCause,
	RuntimeActiveSessionHookLifecycle,
	RuntimeActiveSessionHostOptions,
	RuntimeActiveSessionRuntimePort,
	RuntimeActiveSessionStartSource,
	RuntimeActiveSessionTransition,
	RuntimeActiveSessionTransitionDecision,
	RuntimeActiveSessionTransitionKind,
	RuntimeActiveSessionTransitionLifecycle,
	RuntimeNewSessionOptions,
	RuntimeSessionSeedInitializer,
	RuntimeSessionSeedTarget,
} from "./active-session-host-contracts.js";
export {
	ComposedRuntimeFactory,
	type ComposedRuntimeFactoryOptions,
	type RuntimeAssemblyOperation,
	type RuntimeResourceContext,
	type RuntimeResources,
	type RuntimeSessionPeripherals,
} from "./composed-runtime-factory.js";
export {
	InitializationRollbackScope,
	type InitializationRollbackTask,
} from "./initialization-rollback-scope.js";
export {
	type KernelRuntimeAssembly,
	type KernelRuntimeFactory,
	KernelRuntimeSessionBackend,
	type KernelRuntimeSessionBackendOptions,
	type RuntimePromptAdapter,
	type RuntimePromptResult,
	RuntimeSession,
	type RuntimeSessionCoreAssembly,
	type RuntimeSessionStatus,
} from "./kernel-runtime-session-backend.js";
export { mapKernelEventToSessionEvents } from "./kernel-session-events.js";
export {
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeHostLifecycleObservation,
	type RuntimeHostLifecycleOperation,
} from "./observations.js";
export {
	RuntimeOwnershipBinding,
	type RuntimeOwnershipLease,
	type RuntimeOwnershipManager,
} from "./ownership-binding.js";
export { RetryableCleanup, type RetryableCleanupTask } from "./retryable-cleanup.js";
export type {
	RuntimeCustomEntryInput,
	RuntimeDocumentParticipant,
	RuntimeDocumentParticipantContext,
} from "./runtime-document-participant.js";
export { RuntimeHost } from "./runtime-host.js";
export {
	RuntimeModel,
	type RuntimeModelCatalog,
	type RuntimeModelCredentialResolver,
	type RuntimeModelOptions,
	type RuntimeModelRuntime,
} from "./runtime-model.js";
export {
	KernelRuntimeSessionContextController,
	type RuntimeSessionContextControllerOptions,
} from "./runtime-session-context-controller.js";
export {
	type RuntimeDynamicState,
	type RuntimeSessionIdentity,
	RuntimeSessionProjection,
	type RuntimeStateSource,
} from "./runtime-session-projection.js";
export type {
	CatalogRoutedRuntimeHostSessionBackendOptions,
	RuntimeHostSessionAssembly,
	RuntimeHostSessionAssemblyAssessment,
	RuntimeHostSessionAssemblyCandidate,
	RuntimeHostSessionBackend,
	RuntimeHostSessionBackendRoute,
	RuntimeHostSessionBackendRouteDecision,
	RuntimeHostSessionPortName,
	RuntimeSessionAskUserQuestionCapability,
	RuntimeSessionBackend,
	RuntimeSessionCreateRequest,
} from "./session-backend.js";
export {
	assessRuntimeHostSessionAssembly,
	CatalogRoutedRuntimeHostSessionBackend,
	RUNTIME_HOST_SESSION_PORT_NAMES,
} from "./session-backend.js";
export { mapRuntimeSessionObservationEvent } from "./session-events.js";
export { RuntimeSessionHostInteractionBroker } from "./session-host-interaction-broker.js";
export type {
	RuntimeContextCompactionRequest,
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeExecutionModeUpdate,
	RuntimeModelSelectionStrategy,
	RuntimeSessionBackgroundWorkController,
	RuntimeSessionConfigurationController,
	RuntimeSessionContextController,
	RuntimeSessionContextDeliveryController,
	RuntimeSessionContextDeliveryMode,
	RuntimeSessionContextUsage,
	RuntimeSessionContextUsageView,
	RuntimeSessionConversationView,
	RuntimeSessionCorePorts,
	RuntimeSessionEventStream,
	RuntimeSessionExecutionController,
	RuntimeSessionExecutionObservation,
	RuntimeSessionExecutionObservationStream,
	RuntimeSessionExtensionHost,
	RuntimeSessionHistoryController,
	RuntimeSessionHistoryReader,
	RuntimeSessionHostInteraction,
	RuntimeSessionHostInteractionContext,
	RuntimeSessionIdentityLifecycle,
	RuntimeSessionInputQueueMode,
	RuntimeSessionMetadataController,
	RuntimeSessionModelController,
	RuntimeSessionModelView,
	RuntimeSessionQueueController,
	RuntimeSessionQueueEntryView,
	RuntimeSessionQueueStateView,
	RuntimeSessionQueueView,
	RuntimeSessionState,
	RuntimeSessionStateReader,
	RuntimeSessionToolController,
	RuntimeSessionTurnControl,
	RuntimeSessionWorkspaceView,
	RuntimeSubagentSnapshot,
	RuntimeSubagentUsageSnapshot,
	RuntimeTurnPrompt,
} from "./session-ports.js";
export {
	InMemoryRuntimeSessionMarkerIndex,
	InMemoryRuntimeSessionValueIndex,
	type RuntimeSessionMarkerIndex,
	type RuntimeSessionValueIndex,
} from "./session-resource-index.js";
export type {
	RuntimeHostPathServices,
	RuntimeQueueSidecarStore,
	RuntimeSandboxGrantStore,
	RuntimeSessionAccess,
	RuntimeSessionAccessResolver,
	RuntimeSessionAccessRoute,
	RuntimeSessionCatalog,
	RuntimeSessionFileHistoryReader,
	RuntimeSharedModelController,
} from "./session-services.js";
export {
	CatalogRoutedRuntimeSessionAccessResolver,
	CompositeRuntimeSessionCatalog,
	CompositeRuntimeSessionFileHistoryReader,
} from "./session-services.js";
export {
	type RuntimeActiveSessionCleanupOptions,
	type RuntimePreparedSessionBinding,
	type RuntimeRetiredSessionCleanupOptions,
	RuntimeSessionTransitionCleanup,
} from "./session-transition-cleanup.js";
export type { RunningChangedReason, RuntimeHostCompositionContext, RuntimeHostOptions } from "./types.js";
