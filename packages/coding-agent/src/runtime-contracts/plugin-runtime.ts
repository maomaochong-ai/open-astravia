import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
} from "@vetta/runtime-core";
import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSnapshot, McpRuntimeToolView } from "@vetta/runtime-mcp";

export interface CodingAgentPluginRuntimeSource {
	readonly readAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	readonly invokeSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly invokeContinuation?: AgentPluginContinuationInvoker;
	readonly invokeTool?: AgentPluginToolInvoker;
}

export interface CodingAgentPluginMcpRuntime {
	reconfigure(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<boolean>;
	refresh(): Promise<McpRuntimeToolSnapshot>;
	snapshot(): McpRuntimeToolSnapshot;
	view(): McpRuntimeToolView;
	isManagedTool(toolName: string): boolean;
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
	dispose(): Promise<void>;
}
