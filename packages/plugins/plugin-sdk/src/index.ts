/**
 * @vetta-org/plugin-sdk public surface.
 *
 * Implementation is split by domain under `src/*.ts`; this barrel re-exports
 * the stable package API. Prefer importing from `@vetta-org/plugin-sdk` rather
 * than deep paths.
 */

// Core primitives
export type { ConversationScenario } from "./scenario.js";
export { PLUGIN_PERMISSIONS } from "./permissions.js";
export type { PluginPermission } from "./permissions.js";
export type { Disposable } from "./disposable.js";
export type {
	PluginAgentManifest,
	PluginManifest,
	PluginManifestInput,
	PluginManifestResourceReference,
	PluginMcpServerConfig,
	PluginNetworkManifest,
	PluginSettingSchema,
} from "./manifest.js";

// File explorer
export type {
	PluginFileExplorerEntry,
	PluginWorkspaceRoot,
	PluginFileExplorerWhen,
	PluginFileExplorerActionContext,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerToolbarContext,
	PluginFileExplorerToolbarContribution,
	PluginFileExplorerDecoration,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerChange,
	PluginFileExplorerRevealOptions,
	PluginFileExplorerApi,
} from "./file-explorer.js";

// Conversation
export type {
	ConversationState,
	ConversationMessage,
	ConversationEvent,
	ConversationQueueState,
	CreateSessionOptions,
	PluginConversationApi,
	SendPromptResult,
} from "./conversation.js";

// UI slots
export type {
	PluginGlobalSlotContribution,
	PluginNavBadge,
	PluginNavBadgeTone,
	PluginWorkspaceViewProps,
	PluginWorkspaceViewContribution,
	PluginAudioMetadata,
	PluginPreviewUrlOptions,
	PluginPreviewFile,
	PluginFilePreviewProps,
	PluginFilePreviewContribution,
	PluginActivityTabContribution,
	PluginCaptureRegion,
	PluginOpenActivityTabOptions,
	PluginPromptDecoration,
	PluginInputActionContribution,
	CardDescriptor,
	PluginPendingToolCall,
	PluginCardProps,
	PluginCardRendererContribution,
	PluginToolCallSlotToolCall,
	PluginToolCallSlotProps,
	PluginToolCallSlotContribution,
	PluginTurnCardContribution,
	PluginNotifyOptions,
	PluginUiApi,
} from "./ui.js";

// Keyboard shortcuts (host ShortcutScopeStack)
export type {
	PluginShortcutScopeKind,
	PluginShortcutWhen,
	PluginShortcutBinding,
	PluginShortcutScopeContribution,
	PluginRegisterShortcutScope,
	UsePluginShortcutScopeOptions,
} from "./shortcuts.js";
export { usePluginShortcutScope } from "./shortcuts.js";

// Agent runtime
export type {
	PluginJsonSchema,
	PluginAgentToolApi,
	PluginAgentToolRegistration,
	PluginSystemPromptBlock,
	PluginDynamicSystemPromptOperation,
	PluginSystemPromptMessage,
	PluginSystemPromptProviderContext,
	PluginSystemPromptBlockView,
	PluginAgentActions,
	PluginAgentHandlerContext,
	PluginAgentToolHandler,
	PluginCodingAgentHookEvent,
	PluginCodingAgentHookEventName,
	PluginCodingAgentHookEventOf,
	PluginCodingAgentHookHandler,
	PluginCodingAgentHookHandlerContext,
	PluginCodingAgentHookRegistration,
	PluginCodingAgentHookResult,
	PluginCodingAgentHookTool,
	PluginCodingAgentPermissionMode,
	PluginSystemPromptProviderHandler,
	PluginSystemPromptProviderRegistration,
	PluginContinuationResult,
	PluginContinuationHandler,
	PluginContinuationRegistration,
	PluginAgentApi,
} from "./agent.js";
export { PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES } from "./agent.js";

// App actions
export type {
	PluginAppActionEffect,
	PluginAppActionExample,
	PluginAppActionHandlerContext,
	PluginAppActionHandler,
	PluginAppActionReadyHandler,
	PluginAppActionApprovalPresentation,
	PluginAppActionApproval,
	PluginAppActionRegistration,
	PluginAppActionsApi,
} from "./app-actions.js";
export { PluginAppActionError } from "./app-actions.js";

// Host-managed AI
export type {
	PluginAiApi,
	PluginAiCompleteRequest,
	PluginAiCompleteResult,
	PluginAiModel,
	PluginAiModelListResult,
	PluginAiUsage,
} from "./ai.js";

// Official host capabilities
export type {
	PluginOfficialGeneralSettings,
	PluginOfficialGeneralSettingsUpdate,
	PluginOfficialExperimentalSettings,
	PluginOfficialDownloadItem,
	PluginOfficialUpdaterState,
	PluginOfficialWebhookKind,
	PluginOfficialWebhookEndpoint,
	PluginOfficialWebhookProvider,
	PluginOfficialWebhookCreateInput,
	PluginOfficialWebhookUpdateInput,
	PluginOfficialWebhookMessage,
	PluginOfficialWebhookSendResult,
	PluginOfficialSkillInfo,
	PluginOfficialInstalledSkill,
	PluginOfficialShortcutBinding,
	PluginOfficialQuickPanelSettings,
	PluginOfficialImStatus,
	PluginOfficialImLog,
	PluginOfficialMcpServerSummary,
	PluginOfficialMcpServerDetail,
	PluginOfficialMcpUpsertData,
	PluginOfficialExecutionMode,
	PluginOfficialSelectedSkill,
	PluginOfficialBatchProjectCreateData,
	PluginOfficialBatchProjectUpdateData,
	PluginOfficialSchedulerTaskCreateData,
	PluginOfficialSchedulerTaskUpdateData,
	PluginOfficialModelSummary,
	PluginOfficialProviderSummary,
	PluginOfficialProviderDetail,
	PluginOfficialProviderUpsertData,
	PluginOfficialProjectEntry,
	PluginOfficialSessionHandle,
	PluginOfficialNavigationOpenInput,
	PluginOfficialOpenFilesOptions,
	PluginOfficialOpenedFile,
	PluginOfficialSessionAccess,
	PluginOfficialSessionRunningEvent,
	PluginOfficialSessionSummary,
	PluginOfficialPluginSummary,
	PluginOfficialKnowledgeBase,
	PluginOfficialKnowledgeProcessingSettings,
	PluginOfficialApi,
} from "./official.js";

// Files / command / images / settings
export type {
	PluginFsEntry,
	PluginFsFileRef,
	PluginFsBinaryReadResult,
	PluginFsStatResult,
	PluginFsReadResult,
	PluginFsApi,
} from "./fs.js";
export type {
	PluginCommandRunOptions,
	PluginCommandRunResult,
	PluginCommandSpawnOptions,
	PluginCommandSpawnExit,
	PluginCommandSpawnStatus,
	PluginCommandSpawnHandle,
	PluginCommandApi,
} from "./command.js";
export type {
	PluginCaptureApi,
	PluginOffscreenCaptureOptions,
	PluginOffscreenCaptureResult,
} from "./capture.js";
export type { PluginImageRef } from "./images.js";
export type {
	PluginArtifactDestination,
	PluginArtifactRef,
	PluginArtifactsApi,
	PluginPersistedArtifact,
} from "./artifacts.js";
export type {
	PluginJob,
	PluginJobFailure,
	PluginJobProgress,
	PluginJobRef,
	PluginJobsApi,
	PluginJobStatus,
	PluginJobWaitOptions,
} from "./jobs.js";
export type {
	PluginMediaApi,
	PluginMediaArtifact,
	PluginMediaCapability,
	PluginMediaComposeRequest,
	PluginMediaDimensions,
	PluginMediaErrorCode,
	PluginMediaFailure,
	PluginMediaGenerateRequest,
	PluginMediaGenerationInputSlot,
	PluginMediaGenerationMode,
	PluginMediaGenerationModeCapability,
	PluginMediaInput,
	PluginMediaInputSource,
	PluginMediaInputUploadRequest,
	PluginMediaJob,
	PluginMediaKind,
	PluginMediaOperation,
	PluginMediaOutput,
	PluginMediaOutputKind,
	PluginMediaProviderDescriptor,
	PluginMediaProviderArtifact,
	PluginMediaProviderArtifactSource,
	PluginMediaProviderHandlerContext,
	PluginMediaProviderInput,
	PluginMediaProviderJob,
	PluginMediaProviderRegistration,
	PluginMediaProviderSubmitRequest,
	PluginMediaSubmitRequest,
	PluginMediaTranscodeRequest,
	PluginMediaTransferResponse,
} from "./media.js";
export { PluginMediaError } from "./media.js";
export type {
	PluginPromptAttachment,
	PluginPromptContext,
	PluginPromptContextJsonValue,
} from "./prompt-attachment.js";
export { definePluginPromptContext } from "./prompt-attachment.js";
export type {
	PluginNetworkApi,
	PluginNetworkBody,
	PluginNetworkRequest,
	PluginNetworkResponse,
} from "./network.js";
export type { PluginGatewayApi, PluginGatewayRequest, PluginGatewayResponse } from "./gateway.js";
export type {
	PluginPutBlobInput,
	PluginPutBlobFromFileInput,
	PluginStorageApi,
	PluginStoredBlob,
	PluginStoredBlobRef,
} from "./storage.js";
export type { PluginSettingsApi } from "./settings.js";

// QuickJS sandbox runtime and host-rendered declarative UI
export type {
	PluginDeclarativeActionEvent,
	PluginDeclarativeButton,
	PluginDeclarativeDivider,
	PluginDeclarativeInput,
	PluginDeclarativeNode,
	PluginDeclarativeSection,
	PluginDeclarativeSelect,
	PluginDeclarativeSelectOption,
	PluginDeclarativeStack,
	PluginDeclarativeSwitch,
	PluginDeclarativeText,
	PluginDeclarativeTextarea,
	PluginDeclarativeTextTone,
	PluginQuickJsActivityTab,
	PluginQuickJsApi,
	PluginQuickJsContext,
} from "./quickjs.js";

// i18n
export type {
	PluginLocaleCatalog,
	PluginLocales,
	PluginTranslate,
	PluginI18nApi,
} from "./i18n.js";
export { interpolatePluginText, resolveCatalogKey, resolvePluginText } from "./i18n.js";

// Context & lifecycle
export type {
	PluginPermissionApi,
	AgentMode,
	PluginActivationCleanup,
	PluginContext,
	PluginDefinition,
} from "./context.js";
export { definePlugin } from "./context.js";

// Host bridge (host-injected; plugins use hooks)
export type { PluginHostBridge } from "./host-bridge.js";
export { __setPluginHostBridge } from "./host-bridge.js";

// Activity tab context
export type { ActivityTabContextValue } from "./activity-tab.js";
export { __ActivityTabContext, useActivityTab } from "./activity-tab.js";

// React hooks
export type { PluginI18nContextValue, PluginTranslation } from "./hooks.js";
export {
	__PluginI18nContext,
	useTranslation,
	useActiveConversation,
	useConversationMessages,
	usePromptAttachment,
} from "./hooks.js";
