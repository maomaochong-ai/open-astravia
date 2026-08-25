import type { ConversationScenario, RuntimeObservationPublisher, RuntimeSessionValueIndex } from "@vetta/runtime-core";
import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSource, McpRuntimeToolView } from "@vetta/runtime-mcp";
import { CODING_TOOL_SCOPES, type CodingToolActivation, type CodingToolResultPolicy } from "@vetta/runtime-tools";
import type { CodingAgentSessionExecutionRuntime } from "../../execution/session/runtime.js";
import {
	type CodingAgentKnowledgeRuntime,
	createCodingAgentKnowledgeFilterByTagsToolRegistration,
	createCodingAgentKnowledgeListTagsToolRegistration,
} from "../../features/knowledge/index.js";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import {
	isCodingAgentKnowledgeToolEnabled,
	resolveCodingAgentToolActivation,
} from "../../tool-policy/activation-policy.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { CodingAgentToolEnvironmentFactory } from "../contracts/index.js";
import {
	type CodingAgentMcpSessionCoordinator,
	type CodingAgentMcpSessionIndexes,
	createCodingAgentMcpSessionCoordinator,
} from "./mcp-session-coordinator.js";
import {
	type CodingToolsRuntimeComposition,
	createCodingToolsRuntimeComposition,
} from "./runtime-tools-composition.js";

export interface CodingAgentRuntimeToolSurfaceIndexes extends CodingAgentMcpSessionIndexes {
	readonly configurationStates: RuntimeSessionValueIndex<CodingAgentSessionConfigurationState>;
	readonly executionRuntimes: RuntimeSessionValueIndex<CodingAgentSessionExecutionRuntime>;
}

export interface CodingAgentRuntimeToolSurfaceOptions {
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
	readonly activation?: CodingToolActivation;
	readonly knowledgeRuntime?: CodingAgentKnowledgeRuntime;
	readonly inheritedMcpView: McpRuntimeToolView;
	readonly mcpSource?: McpRuntimeToolSource;
	readonly indexes: CodingAgentRuntimeToolSurfaceIndexes;
	readonly tokenBudget?: number;
	readonly reservedOutputTokens?: number;
	readonly createToolEnvironment: CodingAgentToolEnvironmentFactory;
	readonly resultPolicy?: CodingToolResultPolicy;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

export interface CodingAgentRuntimeToolSurface {
	readonly tools: CodingToolsRuntimeComposition;
	readonly mcpCoordinator: CodingAgentMcpSessionCoordinator;
	readonly activation: CodingToolActivation;
	readonly knowledgeAvailable: boolean;
	readonly backgroundTasksAvailable: boolean;
	resolveActivation(
		context: ModelCallContributionContext,
		activeToolNamesOverride?: readonly string[],
	): CodingToolActivation;
}

/** 组合 Runtime 级 Coding Tools、Knowledge Tool 与共享 MCP Tool Surface。 */
export async function createCodingAgentRuntimeToolSurface(
	options: CodingAgentRuntimeToolSurfaceOptions,
): Promise<CodingAgentRuntimeToolSurface> {
	const activation = options.activation ?? ({ mode: "scope", scope: options.scenario } satisfies CodingToolActivation);
	const knowledgeAvailable = options.knowledgeRuntime !== undefined;
	let backgroundTasksAvailable = false;
	let mcpCoordinator: CodingAgentMcpSessionCoordinator;
	const resolveActivation = (
		context: ModelCallContributionContext,
		activeToolNamesOverride?: readonly string[],
	): CodingToolActivation =>
		resolveCodingAgentToolActivation(
			activation,
			context,
			{ backgroundTasksAvailable, knowledgeAvailable },
			activeToolNamesOverride,
		);
	const environment = await options.createToolEnvironment({
		cwd: options.cwd,
		agentDir: options.agentDir,
		scenario: options.scenario,
	});
	const tools = createCodingToolsRuntimeComposition({
		cwd: options.cwd,
		environment,
		activation,
		resolveActivation: (context) => {
			const configuration = options.indexes.configurationStates.get(context.sessionId);
			return resolveActivation(context, configuration?.readActiveToolNamesOverride());
		},
		filterRegistration: (registration, context) => {
			const executionRuntime = options.indexes.executionRuntimes.get(context.sessionId);
			if (executionRuntime?.ownsTool(registration.tool.name)) return false;
			if (
				registration.category === "kb-read" &&
				!isCodingAgentKnowledgeToolEnabled(activation, context, knowledgeAvailable)
			) {
				return false;
			}
			const controller = options.indexes.mcpControllers.get(context.sessionId);
			return !controller?.isManagedTool(registration.tool.name) || controller.isToolVisible(registration.tool.name);
		},
		additionalRegistrations: [
			...(options.knowledgeRuntime
				? [
						createCodingAgentKnowledgeListTagsToolRegistration({
							operations: options.knowledgeRuntime.query,
							modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.knowledgeTags,
						}),
						createCodingAgentKnowledgeFilterByTagsToolRegistration({
							operations: options.knowledgeRuntime.query,
							modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.knowledgeFilter,
						}),
					]
				: []),
			...options.inheritedMcpView.tools.map(({ tool }) => ({
				tool,
				scopeUse: CODING_TOOL_SCOPES,
				category: "external" as const,
			})),
		],
		tokenBudget: options.tokenBudget,
		reservedOutputTokens: options.reservedOutputTokens,
		resultPolicy: options.resultPolicy,
		observationPublisher: options.observationPublisher,
	});
	backgroundTasksAvailable = tools.backgroundService !== undefined;
	try {
		mcpCoordinator = await createCodingAgentMcpSessionCoordinator({
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
			observationPublisher: options.observationPublisher,
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
