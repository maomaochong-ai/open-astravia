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
	/**
	 * 该工具主推的工作模式 slug；缺省或空数组表示通用。
	 *
	 * 纯偏好声明，**不参与激活过滤**：声明了其他模式的工具在当前模式下同样激活、同样可调用。
	 * 真正的 fail-closed 轴只有 `scopeUse` 与 `requires`。
	 */
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
			/** 当前工作模式 slug；仅供宿主做排序与提示词详略偏好，不参与本包的激活选择。 */
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
	// agent_mode 不是激活轴：工作模式只引导模型该先用什么，不决定工具存不存在。
	// 声明了 `agentModes` 的工具在任何模式下都会被选中；模式偏好由宿主在渲染工具清单时消费。
	return registrations.filter(
		(registration) =>
			additionallyEnabled.has(registration.tool.name) ||
			(registration.scopeUse.includes(scope) &&
				(registration.requires ?? []).every((capability) => capabilities.has(capability))),
	);
}

export function selectCodingToolsForScope(
	registrations: readonly CodingToolRegistration[],
	scope: CodingToolScope,
	capabilities: ReadonlySet<string> = new Set<string>(),
): readonly RuntimeToolDefinition[] {
	return selectCodingTools(registrations, { mode: "scope", scope, capabilities });
}
