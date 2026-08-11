import type { Message } from "@vetta/ai";
import type { ConversationScenario, SessionConfig } from "@vetta/runtime-core";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import type {
	SubagentChildHandle,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentTypeDefinition,
} from "@vetta/runtime-subagents";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";

export interface CodingAgentSubagentProfile {
	readonly activation: CodingToolActivation;
	readonly inheritParentMcp: boolean;
	readonly systemPromptAddon: string;
	readonly forkParentContext: boolean;
	readonly includeTodo: boolean;
	readonly createRuntimeTools?: (cwd: string) => readonly CodingAgentRuntimeToolRegistration[];
	readonly denyToolNamePrefixes?: readonly string[];
}

export interface CodingAgentSubagentChildFactoryContext {
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly readParentSessionId: () => string;
	readonly readParentSessionPath: () => string;
	readonly readModel: () => NonNullable<SessionConfig["model"]>;
	readonly readThinkingLevel: () => NonNullable<SessionConfig["thinkingLevel"]>;
	readonly readInheritedMcpView: () => Promise<McpRuntimeToolView>;
}

export interface CodingAgentSubagentChildFactory {
	create(
		request: SubagentSpawnRequest,
		type: SubagentTypeDefinition<CodingAgentSubagentProfile>,
		forkContext: readonly Message[] | undefined,
		signal?: AbortSignal,
	): Promise<SubagentChildHandle>;
	reopen?(
		snapshot: SubagentSnapshot,
		type: SubagentTypeDefinition<CodingAgentSubagentProfile>,
		forkContext: readonly Message[] | undefined,
		signal?: AbortSignal,
	): Promise<SubagentChildHandle>;
}
