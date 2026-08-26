import type { SessionEndCause, SessionStartSource } from "@vetta/ecosystem-adapter";
import type {
	ConversationScenario,
	RuntimeHostSessionBackend,
	RuntimeObservationHubView,
	RuntimeSession,
} from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistry } from "@vetta/runtime-tools";
import type {
	CodingAgentExtensionEventBinding,
	CodingAgentExtensionRunnerPort,
	CodingAgentExtensionToolSource,
	CodingAgentSessionToolRegistration,
} from "../../runtime-contracts/index.js";
import type { CodingAgentRuntimeSessionOptions } from "./runtime-session-options.js";

export interface CodingAgentRuntimeSessionHookLifecycle {
	end(sessionId: string, cause: SessionEndCause): Promise<void>;
	start(sessionId: string, source: SessionStartSource): void;
	discard(sessionId: string): void;
}

export interface CodingAgentRuntimeSessionControls {
	readonly sessionHooks: CodingAgentRuntimeSessionHookLifecycle;
	appendSessionContext(sessionId: string, records: readonly SessionContextRecord[]): void;
	deliverSessionContext(sessionId: string, records: readonly SessionContextRecord[]): Promise<void>;
	quiesceSessionBackgroundCommands(sessionId: string): Promise<void>;
	preserveSessionExecutionContext(sourceSessionId: string, targetSessionId: string): Promise<void>;
	clearSessionExecutionContext(sessionId: string): void;
	flushMemory(sessionId: string, signal?: AbortSignal): Promise<number>;
	reloadMcp(sessionId: string): Promise<void>;
}

export interface CodingAgentRuntimeExtensionControls {
	bindExtensionRunner(
		sessionId: string,
		runner: CodingAgentExtensionRunnerPort,
		options?: { readonly replaceExisting?: boolean },
	): CodingAgentExtensionEventBinding;
	refreshExtensionTools(extensions: readonly CodingAgentExtensionToolSource[]): void;
	replaceSessionTools(sessionId: string, tools: readonly CodingAgentSessionToolRegistration[]): void;
	clearSessionTools(sessionId: string): void;
}

export interface CodingAgentRuntimeToolAccess {
	readonly registry: CodingToolRegistry;
}

export interface CodingAgentRuntimeAgentIdentity {
	readonly agentId: string;
	readonly instanceId: string;
	readonly revisionId: string;
}

/** @deprecated 新宿主应使用 runtimeHostBackend；保留给直接嵌入产品组合的兼容调用方。 */
export interface CodingAgentRuntimeSessionBackend {
	create(options: CodingAgentRuntimeSessionOptions): Promise<RuntimeSession>;
	resume(options: CodingAgentRuntimeSessionOptions): Promise<RuntimeSession>;
}

export interface CodingAgentRuntimeComposition
	extends CodingAgentRuntimeSessionControls,
		CodingAgentRuntimeExtensionControls {
	/** 直接嵌入产品组合时使用的 Session factory；内部仍由通用 Agent Session Backend 实现。 */
	readonly sessions: CodingAgentRuntimeSessionBackend;
	/** @deprecated 使用 sessions；RuntimeHost 场景使用 runtimeHostBackend。 */
	readonly backend: CodingAgentRuntimeSessionBackend;
	/** 通用 RuntimeHost 后端；由平台适配器补齐 Agent Session 的产品配置。 */
	readonly runtimeHostBackend: RuntimeHostSessionBackend;
	readonly tools: CodingAgentRuntimeToolAccess;
	/** 当前 Composition 在多主 Agent 基座中固定的 Definition revision 与 Instance 身份。 */
	readonly agentRuntime: CodingAgentRuntimeAgentIdentity;
	/** Composition 自有 Hub 的非所有权控制面；调用方可动态注册 Adapter 和读取健康度。 */
	readonly observations: RuntimeObservationHubView;
	readonly scenario: ConversationScenario;
	dispose(): Promise<void>;
}
