/**
 * RuntimeHost 模块入口。
 *
 * `runtime-host.ts` 只保留公共组合根与 SessionFacade 兼容面。内部 owner 按职责拆为：
 * Agent 安装、Session 生命周期/目录/事件/在线操作、离线 Catalog、宿主交互、队列持久化与关闭协调。
 * Kernel、历史和事件投影仍通过本入口暴露稳定公共合同，内部协调器不导出。
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
	RuntimeActiveSession,
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
	RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES,
	type RuntimeHostAgentBackendCandidate,
	type RuntimeHostAgentBackendEntrySnapshot,
	RuntimeHostAgentBackendError,
	type RuntimeHostAgentBackendErrorCode,
	type RuntimeHostAgentBackendPublishResult,
	RuntimeHostAgentBackendRegistry,
	type RuntimeHostAgentBackendRegistryOptions,
	type RuntimeHostAgentBackendRegistrySnapshot,
	type RuntimeHostAgentBackendRetirement,
	type RuntimeHostAgentBackendRevision,
} from "./agent-backend-admission.js";
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
	RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION,
	RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeActiveSessionHostObservation,
	type RuntimeActiveSessionHostOperation,
	type RuntimeHostAgentBackendObservation,
	type RuntimeHostAgentBackendOperation,
	type RuntimeHostLifecycleObservation,
	type RuntimeHostLifecycleOperation,
} from "./observations.js";
export {
	RuntimeOwnershipBinding,
	type RuntimeOwnershipLease,
	type RuntimeOwnershipManager,
} from "./ownership-binding.js";
export {
	RetryableCleanup,
	type RetryableCleanupTask,
	RetryableCloseController,
	type RetryableCloseControllerOptions,
} from "./retryable-cleanup.js";
export {
	RuntimeAgentInstancePool,
	type RuntimeAgentInstancePoolLease,
	type RuntimeAgentInstancePoolOptions,
} from "./runtime-agent-instance-pool.js";
export {
	type RuntimeAgentAssemblyCreateInput,
	type RuntimeAgentPreparedInstance,
	RuntimeAgentSessionAssemblyBackend,
	type RuntimeAgentSessionAssemblyBackendOptions,
	type RuntimeAgentSessionAssemblyDecoratorContext,
	type RuntimeAgentSessionConfigurationContext,
	type RuntimeAgentSessionConfigurationResolver,
	type RuntimeAgentSessionIdentity,
	type RuntimeAgentSessionIdentityResolver,
	type RuntimeAgentSessionResourceFactory,
	type RuntimeAgentSessionResourceFactoryContext,
} from "./runtime-agent-session-backend.js";
export type {
	RuntimeCustomEntryInput,
	RuntimeDocumentParticipant,
	RuntimeDocumentParticipantContext,
} from "./runtime-document-participant.js";
export { RuntimeHost } from "./runtime-host.js";
export { RuntimeHostSession } from "./runtime-host-session.js";
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
	RuntimeSessionBackend,
	RuntimeSessionCreateRequest,
} from "./session-backend.js";
export {
	assessRuntimeHostSessionAssembly,
	CatalogRoutedRuntimeHostSessionBackend,
	RUNTIME_HOST_SESSION_PORT_NAMES,
} from "./session-backend.js";
export { mapRuntimeSessionObservationEvent } from "./session-events.js";
export {
	createRuntimeSessionExtensionHost,
	type RuntimeSessionExtensionSource,
} from "./session-extension-host.js";
export type {
	RuntimeContextCompactionRequest,
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeContextSummaryRequest,
	RuntimeContextSummaryResult,
	RuntimeExecutionModeUpdate,
	RuntimeModelSelectionStrategy,
	RuntimeSessionConfigurationController,
	RuntimeSessionContextController,
	RuntimeSessionContextDeliveryController,
	RuntimeSessionContextDeliveryMode,
	RuntimeSessionContextUsage,
	RuntimeSessionContextUsageView,
	RuntimeSessionConversationController,
	RuntimeSessionConversationView,
	RuntimeSessionCorePorts,
	RuntimeSessionEventStream,
	RuntimeSessionExecutionController,
	RuntimeSessionExecutionObservation,
	RuntimeSessionExecutionObservationStream,
	RuntimeSessionExtensionHost,
	RuntimeSessionHistoryController,
	RuntimeSessionHistoryReader,
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
	RuntimeTurnPrompt,
} from "./session-ports.js";
export {
	InMemoryRuntimeSessionMarkerIndex,
	InMemoryRuntimeSessionValueIndex,
	type RuntimeSessionMarkerIndex,
	type RuntimeSessionValueIndex,
} from "./session-resource-index.js";
export {
	DeferredRuntimeRetryEventStream,
	type RuntimeHostSessionRetryOptions,
	withRuntimeHostSessionRetry,
} from "./session-retry.js";
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
export type {
	RunningChangedReason,
	RuntimeHostAgentInstallation,
	RuntimeHostAgentInstallationOptions,
	RuntimeHostAgentInstallationRetirement,
	RuntimeHostCompositionContext,
	RuntimeHostOptions,
} from "./types.js";
