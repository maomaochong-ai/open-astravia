import type { SessionEndCause, SessionStartSource } from "@vetta/ecosystem-adapter";
import type { ConversationScenario, GreenfieldRuntimeSessionBackend } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistry } from "@vetta/runtime-tools/coding";
import type {
	CodingAgentGreenfieldExtensionEventBinding,
	CodingAgentGreenfieldExtensionRunnerPort,
	CodingAgentGreenfieldExtensionToolSource,
	CodingAgentGreenfieldSessionToolRegistration,
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
		runner: CodingAgentGreenfieldExtensionRunnerPort,
		options?: { readonly replaceExisting?: boolean },
	): CodingAgentGreenfieldExtensionEventBinding;
	refreshExtensionTools(extensions: readonly CodingAgentGreenfieldExtensionToolSource[]): void;
	replaceSessionTools(sessionId: string, tools: readonly CodingAgentGreenfieldSessionToolRegistration[]): void;
	clearSessionTools(sessionId: string): void;
}

export interface CodingAgentRuntimeToolAccess {
	readonly registry: CodingToolRegistry;
}

export interface CodingAgentRuntimeComposition
	extends CodingAgentRuntimeSessionControls,
		CodingAgentRuntimeExtensionControls {
	readonly backend: GreenfieldRuntimeSessionBackend<CodingAgentRuntimeSessionOptions>;
	readonly tools: CodingAgentRuntimeToolAccess;
	readonly scenario: ConversationScenario;
	dispose(): Promise<void>;
}
