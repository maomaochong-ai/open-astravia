import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";

export const CODING_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const;

export type CodingToolScope = (typeof CODING_TOOL_SCOPES)[number];

export const DEFAULT_CODING_TOOL_SCOPE: CodingToolScope = "cli";

export type CodingToolCategory =
	| "core"
	| "doc"
	| "kb-write"
	| "kb-read"
	| "agent-control"
	| "media"
	| "im"
	| "memory"
	| "external";

export interface CodingToolRegistration<TInput extends object = Readonly<Record<string, unknown>>> {
	readonly tool: RuntimeToolDefinition<TInput>;
	readonly scopeUse: readonly CodingToolScope[];
	/**
	 * Session capabilities required for normal scope activation.
	 * Explicit and additionally-enabled activations intentionally bypass this
	 * filter, matching the legacy explicit-tool contract.
	 */
	readonly requires?: readonly string[];
	/** 工作模式白名单；缺省或空数组表示通用。 */
	readonly agentModes?: readonly string[];
	/** 最终模型工具数组中的稳定顺序；未声明的动态工具保持贡献顺序并排在其后。 */
	readonly modelOrder?: number;
	readonly category: CodingToolCategory;
}

export type CodingToolActivation =
	| {
			readonly mode: "scope";
			readonly scope?: CodingToolScope;
			readonly additionallyEnabledToolNames?: readonly string[];
			readonly capabilities?: ReadonlySet<string>;
			readonly agentMode?: string;
	  }
	| {
			readonly mode: "explicit";
			readonly toolNames: readonly string[];
	  };

export function selectCodingTools(
	registrations: readonly CodingToolRegistration[],
	activation: CodingToolActivation,
): readonly RuntimeToolDefinition[] {
	return selectCodingToolRegistrations(registrations, activation).map(({ tool }) => tool);
}

export function selectCodingToolRegistrations(
	registrations: readonly CodingToolRegistration[],
	activation: CodingToolActivation,
): readonly CodingToolRegistration[] {
	if (activation.mode === "explicit") {
		const explicitlyEnabled = new Set(activation.toolNames);
		return registrations.filter((registration) => explicitlyEnabled.has(registration.tool.name));
	}

	const scope = activation.scope ?? DEFAULT_CODING_TOOL_SCOPE;
	const additionallyEnabled = new Set(activation.additionallyEnabledToolNames ?? []);
	const capabilities = activation.capabilities ?? new Set<string>();
	return registrations.filter(
		(registration) =>
			additionallyEnabled.has(registration.tool.name) ||
			(registration.scopeUse.includes(scope) &&
				(registration.requires ?? []).every((capability) => capabilities.has(capability)) &&
				matchesAgentMode(registration.agentModes, activation.agentMode)),
	);
}

export function selectCodingToolsForScope(
	registrations: readonly CodingToolRegistration[],
	scope: CodingToolScope,
	capabilities: ReadonlySet<string> = new Set<string>(),
): readonly RuntimeToolDefinition[] {
	return selectCodingTools(registrations, { mode: "scope", scope, capabilities });
}

function matchesAgentMode(declared: readonly string[] | undefined, active: string | undefined): boolean {
	if (active === undefined || !declared || declared.length === 0) return true;
	return declared.includes(active);
}
