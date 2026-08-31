import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSnapshot, McpRuntimeToolView } from "@vetta/runtime-mcp";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	AgentPluginTurnHandlerLeaseProvider,
} from "../model-context/plugin-runtime.js";

export interface CodingAgentPluginRuntimeSource {
	/** Includes hook-only plugins that do not contribute a Prompt or Tool. */
	readonly readPluginIds?: () => readonly string[];
	readonly readAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	/** 配置源发布新版本；已开始的 Turn 仍由 admission lease 保持旧快照。 */
	readonly subscribe?: (listener: () => void) => () => void;
	readonly invokeSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly invokeContinuation?: AgentPluginContinuationInvoker;
	readonly invokeTool?: AgentPluginToolInvoker;
	readonly handlerLeaseProvider?: AgentPluginTurnHandlerLeaseProvider;
}

export interface CodingAgentPluginMcpToolComposer {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): CodingAgentPluginMcpToolComposer;
	releaseTurnBinding?(): Promise<void> | void;
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
