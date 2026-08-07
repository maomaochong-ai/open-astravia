import type { ConversationScenario } from "@vetta/runtime-core";
import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSource, McpRuntimeToolView } from "@vetta/runtime-mcp";
import {
	CODING_TOOL_SCOPES,
	type CodingToolActivation,
	createKbFilterByTagsToolRegistration,
	createKbListTagsToolRegistration,
} from "@vetta/runtime-tools/coding";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../adapters/runtime-core/greenfield-model-tool-order.js";
import { createCodingAgentKnowledgeQueryOperations } from "./coding-agent-knowledge-runtime.js";
import {
	createGreenfieldMcpSessionCoordinator,
	type GreenfieldMcpSessionCoordinator,
	type GreenfieldMcpSessionIndexes,
} from "./greenfield-mcp-session-coordinator.js";
import type { GreenfieldSessionExecutionRuntime } from "./greenfield-session-execution-runtime.js";
import type { GreenfieldSessionConfigurationState } from "./greenfield-session-peripherals.js";
import type { GreenfieldSessionValueIndex } from "./greenfield-session-resource-index.js";
import {
	isGreenfieldKnowledgeToolEnabled,
	resolveGreenfieldToolActivation,
} from "./greenfield-tool-activation-policy.js";
import {
	type CodingToolsRuntimeComposition,
	createCodingToolsRuntimeComposition,
} from "./runtime-tools-composition.js";

export interface GreenfieldRuntimeToolSurfaceIndexes extends GreenfieldMcpSessionIndexes {
	readonly configurationStates: GreenfieldSessionValueIndex<GreenfieldSessionConfigurationState>;
	readonly executionRuntimes: GreenfieldSessionValueIndex<GreenfieldSessionExecutionRuntime>;
}

export interface GreenfieldRuntimeToolSurfaceOptions {
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly activation?: CodingToolActivation;
	readonly knowledgeEnabled?: boolean;
	readonly knowledgeRoot?: string;
	readonly inheritedMcpView: McpRuntimeToolView;
	readonly mcpSource?: McpRuntimeToolSource;
	readonly indexes: GreenfieldRuntimeToolSurfaceIndexes;
	readonly tokenBudget?: number;
	readonly reservedOutputTokens?: number;
}

export interface GreenfieldRuntimeToolSurface {
	readonly tools: CodingToolsRuntimeComposition;
	readonly mcpCoordinator: GreenfieldMcpSessionCoordinator;
	readonly activation: CodingToolActivation;
	readonly knowledgeAvailable: boolean;
	readonly backgroundTasksAvailable: boolean;
	resolveActivation(
		context: ModelCallContributionContext,
		agentMode?: string,
		activeToolNamesOverride?: readonly string[],
	): CodingToolActivation;
}

/** 组合 Runtime 级 Coding Tools、Knowledge Tool 与共享 MCP Tool Surface。 */
export async function createGreenfieldRuntimeToolSurface(
	options: GreenfieldRuntimeToolSurfaceOptions,
): Promise<GreenfieldRuntimeToolSurface> {
	const activation = options.activation ?? ({ mode: "scope", scope: options.scenario } satisfies CodingToolActivation);
	const knowledgeAvailable = options.knowledgeEnabled ?? process.env.VETTA_KNOWLEDGE_DISABLED !== "1";
	const knowledgeOperations = createCodingAgentKnowledgeQueryOperations(options.knowledgeRoot);
	let backgroundTasksAvailable = false;
	let mcpCoordinator: GreenfieldMcpSessionCoordinator;
	const resolveActivation = (
		context: ModelCallContributionContext,
		agentMode?: string,
		activeToolNamesOverride?: readonly string[],
	): CodingToolActivation =>
		resolveGreenfieldToolActivation(
			activation,
			context,
			{ backgroundTasksAvailable, knowledgeAvailable },
			agentMode,
			activeToolNamesOverride,
		);
	const tools = createCodingToolsRuntimeComposition({
		cwd: options.cwd,
		activation,
		resolveActivation: (context) => {
			const configuration = options.indexes.configurationStates.get(context.sessionId);
			return resolveActivation(
				context,
				configuration?.readAgentMode(),
				configuration?.readActiveToolNamesOverride(),
			);
		},
		refreshCatalog: async (context) => {
			await mcpCoordinator.refreshCatalogForModelCall(context.sessionId);
		},
		filterRegistration: (registration, context) => {
			const executionRuntime = options.indexes.executionRuntimes.get(context.sessionId);
			if (executionRuntime?.ownsTool(registration.tool.name)) return false;
			if (
				registration.category === "kb-read" &&
				!isGreenfieldKnowledgeToolEnabled(activation, context, knowledgeAvailable)
			) {
				return false;
			}
			const controller = options.indexes.mcpControllers.get(context.sessionId);
			return !controller?.isManagedTool(registration.tool.name) || controller.isToolVisible(registration.tool.name);
		},
		additionalRegistrations: [
			createKbListTagsToolRegistration({
				operations: knowledgeOperations,
				modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.knowledgeTags,
			}),
			createKbFilterByTagsToolRegistration({
				operations: knowledgeOperations,
				modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.knowledgeFilter,
			}),
			...options.inheritedMcpView.tools.map(({ tool }) => ({
				tool,
				scopeUse: CODING_TOOL_SCOPES,
				category: "external" as const,
			})),
		],
		tokenBudget: options.tokenBudget,
		reservedOutputTokens: options.reservedOutputTokens,
	});
	backgroundTasksAvailable = tools.backgroundService !== undefined;
	try {
		mcpCoordinator = await createGreenfieldMcpSessionCoordinator({
			source: options.mcpSource,
			indexes: options.indexes,
			registry: {
				register: (tool) =>
					tools.registry.register({
						tool,
						scopeUse: CODING_TOOL_SCOPES,
						category: "external",
					}),
				unregister: (toolName) => tools.registry.unregister(toolName),
			},
		});
	} catch (error) {
		tools.dispose();
		throw error;
	}
	return {
		tools,
		mcpCoordinator,
		activation,
		knowledgeAvailable,
		backgroundTasksAvailable,
		resolveActivation,
	};
}
