import type { SessionEndCause, SessionStartSource } from "@vetta/ecosystem-adapter";
import type { RuntimeHostSessionBackend, RuntimeObservationHubView } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistry } from "@vetta/runtime-tools";
import type { ConversationScenario } from "../../profiles/index.js";
import type {
	CodingAgentExtensionEventBinding,
	CodingAgentExtensionRunnerPort,
	CodingAgentExtensionToolSource,
	CodingAgentRuntimeToolRegistration,
	CodingAgentSessionToolRegistration,
} from "../../runtime-contracts/index.js";

export interface CodingAgentRuntimeSessionHookLifecycle {
	end(sessionId: string, cause: SessionEndCause): Promise<void>;
	start(sessionId: string, source: SessionStartSource): void;
	discard(sessionId: string): void;
}

export interface CodingAgentRuntimeSessionControls {
	/** 仅返回本 Composition 持有的活动 Session 身份；关闭后或未知 Session 返回 undefined。 */
	readSessionAgentIdentity(sessionId: string): CodingAgentRuntimeAgentIdentity | undefined;
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
	registerTool(registration: CodingAgentRuntimeToolRegistration): void;
	unregisterTool(toolName: string): boolean;
}

export interface CodingAgentRuntimeAgentReference {
	readonly agentId: string;
}

export interface CodingAgentRuntimeAgentIdentity extends CodingAgentRuntimeAgentReference {
	readonly instanceId: string;
	readonly revisionId: string;
}

export interface CodingAgentRuntimeComposition
	extends CodingAgentRuntimeSessionControls,
		CodingAgentRuntimeExtensionControls {
	/** 唯一 Session 创建入口；平台适配器只补齐 Agent Session 的私有配置。 */
	readonly runtimeHostBackend: RuntimeHostSessionBackend;
	readonly tools: CodingAgentRuntimeToolAccess;
	/** 资源组合的 Agent 选择；Instance 和 revision 在每次创建 Session 时绑定。 */
	readonly agentRuntime: CodingAgentRuntimeAgentReference;
	/** Composition 自有 Hub 的非所有权控制面；调用方可动态注册 Adapter 和读取健康度。 */
	readonly observations: RuntimeObservationHubView;
	readonly scenario: ConversationScenario;
	dispose(): Promise<void>;
}
