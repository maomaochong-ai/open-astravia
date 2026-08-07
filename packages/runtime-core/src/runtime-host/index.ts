/**
 * RuntimeHost 模块入口。
 *
 * 目录职责：
 * - runtime-host.ts      会话生命周期与编排（SessionFacade）
 * - session-events.ts    旧事件 → Session Observation → SessionEvent 映射
 * - greenfield-session-events.ts  KernelEvent → SessionEvent 映射
 * - history.ts           会话历史 / 分支 / turn timing 解析
 * - peripheral-tasks.ts  自动标题、输入预测（轻量 LLM + 失败轮转）
 * - plugin-debug.ts      插件调试日志
 * - types.ts             共享类型
 */

export type {
	GreenfieldRuntimeCustomEntryInput,
	GreenfieldRuntimeDocumentParticipant,
	GreenfieldRuntimeDocumentParticipantContext,
} from "./greenfield-document-participant.js";
export {
	GreenfieldRuntimeModel,
	type GreenfieldRuntimeModelOptions,
	type GreenfieldRuntimeModelRuntime,
	type RuntimeModelCatalog,
	type RuntimeModelCredentialResolver,
} from "./greenfield-model-runtime.js";
export {
	ComposedGreenfieldRuntimeFactory,
	type ComposedGreenfieldRuntimeFactoryOptions,
	type GreenfieldRuntimeOperation,
	type GreenfieldRuntimeResourceContext,
	type GreenfieldRuntimeResources,
	type GreenfieldRuntimeSessionPeripherals,
} from "./greenfield-runtime-factory.js";
export {
	type GreenfieldRuntimeAssembly,
	type GreenfieldRuntimeFactory,
	GreenfieldRuntimeSession,
	GreenfieldRuntimeSessionBackend,
	type GreenfieldRuntimeSessionBackendOptions,
	type GreenfieldRuntimeSessionCoreAssembly,
	type GreenfieldRuntimeSessionState,
	type RuntimeHandledPromptResult,
	type RuntimePreparedPrompt,
	type RuntimePromptAdapter,
	type RuntimePromptInterceptionResult,
	type RuntimePromptPreparationContext,
	type RuntimePromptResult,
} from "./greenfield-session-backend.js";
export {
	GreenfieldSessionContextController,
	type GreenfieldSessionContextControllerOptions,
} from "./greenfield-session-context-controller.js";
export { mapGreenfieldKernelEventToSessionEvents } from "./greenfield-session-events.js";
export {
	type GreenfieldRuntimeDynamicState,
	type GreenfieldRuntimeSessionIdentity,
	type GreenfieldRuntimeStateSource,
	GreenfieldSessionProjection,
} from "./greenfield-session-projection.js";
export {
	InitializationRollbackScope,
	type InitializationRollbackTask,
} from "./initialization-rollback-scope.js";
export { RetryableCleanup, type RetryableCleanupTask } from "./retryable-cleanup.js";
export { RuntimeHost } from "./runtime-host.js";
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
	RuntimeSessionQueueView,
	RuntimeSessionState,
	RuntimeSessionStateReader,
	RuntimeSessionTodoController,
	RuntimeSessionToolController,
	RuntimeSessionTurnControl,
	RuntimeSessionWorkspaceView,
	RuntimeSubagentSnapshot,
	RuntimeSubagentUsageSnapshot,
	RuntimeTurnPrompt,
} from "./session-ports.js";
export type {
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
export type { RunningChangedReason, RuntimeHostOptions } from "./types.js";
