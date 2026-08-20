import type { ConversationScenario } from "@vetta/runtime-core";
import type { CodingToolActivation } from "@vetta/runtime-tools";
import type {
	CodingAgentSubagentContextPolicy,
	CodingAgentSubagentMcpPolicy,
	CodingAgentSubagentProfile,
	CodingAgentSubagentSkillPolicy,
	CodingAgentSubagentTodoPolicy,
	CodingAgentSubagentWorkspacePolicy,
} from "../contracts/index.js";

export interface ResolvedCodingAgentSubagentProfile {
	readonly activation: CodingToolActivation;
	readonly mcpPolicy: CodingAgentSubagentMcpPolicy;
	readonly skillPolicy: CodingAgentSubagentSkillPolicy;
	readonly contextPolicy: CodingAgentSubagentContextPolicy;
	readonly todoPolicy: CodingAgentSubagentTodoPolicy;
	readonly workspacePolicy: CodingAgentSubagentWorkspacePolicy;
}

/** Resolves new policies and the temporary legacy fields at one compatibility boundary. */
export function resolveCodingAgentSubagentProfile(
	profile: CodingAgentSubagentProfile,
	scenario: ConversationScenario,
	parentActivation?: CodingToolActivation,
): ResolvedCodingAgentSubagentProfile {
	const activation = resolveActivation(profile, scenario, parentActivation);
	const inheritedPrefixes = profile.denyToolNamePrefixes;
	const mcpPolicy =
		profile.mcpPolicy ??
		(profile.inheritParentMcp === false
			? { mode: "none" }
			: { mode: "inherit", ...(inheritedPrefixes ? { denyNamePrefixes: inheritedPrefixes } : {}) });
	return {
		activation,
		mcpPolicy,
		skillPolicy: profile.skillPolicy ?? { mode: "inherit" },
		contextPolicy:
			profile.contextPolicy ?? (profile.forkParentContext === false ? { mode: "fresh" } : { mode: "full" }),
		todoPolicy: profile.todoPolicy ?? (profile.includeTodo === true ? { mode: "enabled" } : { mode: "disabled" }),
		workspacePolicy: profile.workspacePolicy ?? { mode: "shared" },
	};
}

function resolveActivation(
	profile: CodingAgentSubagentProfile,
	scenario: ConversationScenario,
	parentActivation?: CodingToolActivation,
): CodingToolActivation {
	if (profile.toolPolicy?.mode === "activation") return withScenario(profile.toolPolicy.activation, scenario);
	if (profile.toolPolicy?.mode === "inherit") return withScenario(parentActivation ?? { mode: "scope" }, scenario);
	if (profile.activation) return withScenario(profile.activation, scenario);
	return withScenario(parentActivation ?? { mode: "scope" }, scenario);
}

function withScenario(activation: CodingToolActivation, scenario: ConversationScenario): CodingToolActivation {
	return activation.mode === "scope" && activation.scope === undefined
		? { ...activation, scope: scenario }
		: activation;
}
