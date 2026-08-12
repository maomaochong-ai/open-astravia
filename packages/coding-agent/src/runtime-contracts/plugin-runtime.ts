import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
} from "@vetta/runtime-core";
import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSnapshot, McpRuntimeToolView } from "@vetta/runtime-mcp";

export interface CodingAgentPluginRuntimeSource {
	readonly readAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	readonly invokeSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly invokeContinuation?: AgentPluginContinuationInvoker;
	readonly invokeTool?: AgentPluginToolInvoker;
}

export interface CodingAgentPluginMcpToolComposer {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): CodingAgentPluginMcpToolComposer;
	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		options: {
			readonly agentMode?: string;
			readonly isToolVisible: (toolName: string) => boolean;
		},
	): {
		readonly frame: ModelCallFrame;
		readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
	};
}

export interface CodingAgentPluginMcpRuntime extends CodingAgentPluginMcpToolComposer {
	reconfigure(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<boolean>;
	refresh(): Promise<McpRuntimeToolSnapshot>;
	snapshot(): McpRuntimeToolSnapshot;
	view(): McpRuntimeToolView;
	isManagedTool(toolName: string): boolean;
	dispose(): Promise<void>;
}
