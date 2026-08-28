import { createCodingAgentHostFromSessionFactory } from "../host/coding-agent-host.js";
import { createCodingAgentSessionCatalogFromPublicOptions } from "../host/coding-agent-sdk-session-catalog.js";
import { createCodingAgentSessionFromPublicOptions } from "../host/sdk-session/index.js";
import type {
	CodingAgentHost,
	CodingAgentSessionCatalog,
	CreateCodingAgentHostOptions,
	CreateCodingAgentSessionCatalogOptions,
	CreateCodingAgentSessionOptions,
	CreateCodingAgentSessionResult,
} from "./sdk/index.js";

/** 创建拥有多个隔离 Coding Agent Session 的 SDK 产品所有权组；它不是多主 Agent RuntimeHost。 */
export function createCodingAgentHost(options: CreateCodingAgentHostOptions = {}): CodingAgentHost {
	return createCodingAgentHostFromSessionFactory(options, (sessionOptions, lifecycle) =>
		createCodingAgentSessionFromPublicOptions(sessionOptions, { onSessionClosed: lifecycle.onClosed }),
	);
}

/** 创建不暴露宿主具体管理器的公共 Coding Agent Session。 */
export function createCodingAgentSession(
	options: CreateCodingAgentSessionOptions = {},
): Promise<CreateCodingAgentSessionResult> {
	return createCodingAgentSessionFromPublicOptions(options);
}

/** 创建与活动 Session 生命周期分离的离线会话目录查询门面。 */
export function createCodingAgentSessionCatalog(
	options: CreateCodingAgentSessionCatalogOptions,
): CodingAgentSessionCatalog {
	return createCodingAgentSessionCatalogFromPublicOptions(options);
}

export type {
	CodingAgentActiveSessionCapabilities,
	CodingAgentBashOperations,
	CodingAgentBashResult,
	CodingAgentBranchSummaryEntry,
	CodingAgentContextFileContribution,
	CodingAgentExtensionSource,
	CodingAgentExtensionSourceSnapshot,
	CodingAgentFixedSession,
	CodingAgentHost,
	CodingAgentHostSessionDefaults,
	CodingAgentMemoryConfiguration,
	CodingAgentModelCycleResult,
	CodingAgentNewSessionOptions,
	CodingAgentPromptInputSource,
	CodingAgentPromptOptions,
	CodingAgentPromptTemplate,
	CodingAgentPromptTemplateContribution,
	CodingAgentQuestionAnswer,
	CodingAgentQuestionCapability,
	CodingAgentQuestionItem,
	CodingAgentQuestionOption,
	CodingAgentQuestionRequest,
	CodingAgentQuestionResult,
	CodingAgentResourceContributions,
	CodingAgentResourceSourceInvalidationListener,
	CodingAgentResourceSourceRevision,
	CodingAgentRetryEvent,
	CodingAgentScopedModel,
	CodingAgentSession,
	CodingAgentSessionBranchEntry,
	CodingAgentSessionCapabilities,
	CodingAgentSessionCatalog,
	CodingAgentSessionCore,
	CodingAgentSessionCreateErrorCode,
	CodingAgentSessionDiagnostic,
	CodingAgentSessionEvent,
	CodingAgentSessionEventListener,
	CodingAgentSessionFeatureEvent,
	CodingAgentSessionObservationOptions,
	CodingAgentSessionObservationRoute,
	CodingAgentSessionSetup,
	CodingAgentSessionStats,
	CodingAgentSessionStorageTarget,
	CodingAgentSessionSummary,
	CodingAgentSessionToolDefinition,
	CodingAgentSkillContribution,
	CodingAgentSkillInfo,
	CodingAgentSkillPolicy,
	CodingAgentSkillSelector,
	CodingAgentSkillSource,
	CodingAgentSkillSourceSnapshot,
	CodingAgentSubagentSnapshot,
	CodingAgentSubagentTodoProgress,
	CodingAgentToolCompactionOptions,
	CodingAgentToolExecutionContext,
	CodingAgentToolInfo,
	CodingAgentToolPermissionRequest,
	CodingAgentToolPermissionResult,
	CodingAgentToolRenderComponent,
	CodingAgentToolRenderResultOptions,
	CodingAgentToolTheme,
	CodingAgentToolThemeBackground,
	CodingAgentToolThemeColor,
	CodingAgentToolUiContext,
	CodingAgentToolUiDialogOptions,
	CodingAgentTreeNavigationOptions,
	CodingAgentTreeNavigationResult,
	CreateCodingAgentHostOptions,
	CreateCodingAgentSessionCatalogOptions,
	CreateCodingAgentSessionOptions,
	CreateCodingAgentSessionResult,
} from "./sdk/index.js";
export { CODING_AGENT_SESSION_CREATE_ERROR_CODES, CodingAgentSessionCreateError } from "./sdk/index.js";
