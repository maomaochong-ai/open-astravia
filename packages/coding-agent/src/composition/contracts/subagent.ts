import type { Message } from "@vetta/ai";
import type { ConversationScenario, SessionConfig } from "@vetta/runtime-core";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import type {
	SubagentChildHandle,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentTypeDefinition,
} from "@vetta/runtime-subagents";
import type { CodingToolActivation } from "@vetta/runtime-tools";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";

export interface CodingAgentSubagentProfile {
	/** Tool inheritance defaults to the parent's activation when omitted. */
	readonly toolPolicy?: CodingAgentSubagentToolPolicy;
	/** MCP inheritance defaults to the parent view when omitted. */
	readonly mcpPolicy?: CodingAgentSubagentMcpPolicy;
	/** Skills inherit from the parent by default and may be hidden or allow-listed. */
	readonly skillPolicy?: CodingAgentSubagentSkillPolicy;
	/** Parent context defaults to a full point-in-time snapshot. */
	readonly contextPolicy?: CodingAgentSubagentContextPolicy;
	/** Todo is disabled by default unless the definition explicitly enables it. */
	readonly todoPolicy?: CodingAgentSubagentTodoPolicy;
	/** Workspace defaults to the parent's cwd; hosts may provide isolated leases for selected definitions. */
	readonly workspacePolicy?: CodingAgentSubagentWorkspacePolicy;
	readonly systemPromptAddon: string;
	readonly createRuntimeTools?: (cwd: string) => readonly CodingAgentRuntimeToolRegistration[];
	/** @deprecated Use toolPolicy. Kept while custom registries migrate. */
	readonly activation?: CodingToolActivation;
	/** @deprecated Use mcpPolicy. Kept while custom registries migrate. */
	readonly inheritParentMcp?: boolean;
	/** @deprecated Use contextPolicy. Kept while custom registries migrate. */
	readonly forkParentContext?: boolean;
	/** @deprecated Use todoPolicy. Kept while custom registries migrate. */
	readonly includeTodo?: boolean;
	/** @deprecated Use mcpPolicy.denyNamePrefixes. */
	readonly denyToolNamePrefixes?: readonly string[];
}

export type CodingAgentSubagentToolPolicy =
	| { readonly mode: "inherit" }
	| { readonly mode: "activation"; readonly activation: CodingToolActivation };

export type CodingAgentSubagentMcpPolicy =
	| { readonly mode: "inherit"; readonly denyNamePrefixes?: readonly string[] }
	| { readonly mode: "none" };

export type CodingAgentSubagentSkillPolicy =
	| { readonly mode: "inherit" }
	| { readonly mode: "none" }
	| { readonly mode: "allow"; readonly names: readonly string[] };

export type CodingAgentSubagentContextPolicy = { readonly mode: "full" } | { readonly mode: "fresh" };

export type CodingAgentSubagentTodoPolicy = { readonly mode: "enabled" } | { readonly mode: "disabled" };

export type CodingAgentSubagentWorkspacePolicy =
	| { readonly mode: "shared" }
	| { readonly mode: "isolated"; readonly fallback: "error" | "shared" };

export interface CodingAgentSubagentWorkspaceLease {
	readonly cwd: string;
	readonly mode: "shared" | "isolated";
	release(): Promise<void> | void;
}

export interface CodingAgentSubagentWorkspacePort {
	acquire(input: {
		readonly parentCwd: string;
		readonly childId: string;
		readonly taskName: string;
		readonly policy: CodingAgentSubagentWorkspacePolicy;
	}): Promise<CodingAgentSubagentWorkspaceLease>;
}

export interface CodingAgentSubagentChildFactoryContext {
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly readParentSessionId: () => string;
	readonly readParentSessionPath: () => string;
	readonly readModel: () => NonNullable<SessionConfig["model"]>;
	readonly readThinkingLevel: () => NonNullable<SessionConfig["thinkingLevel"]>;
	readonly readInheritedMcpView: () => Promise<McpRuntimeToolView>;
	readonly readParentToolActivation: () => CodingToolActivation | undefined;
	readonly workspacePort?: CodingAgentSubagentWorkspacePort;
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
