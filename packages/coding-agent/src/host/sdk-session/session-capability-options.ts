import type { Api, Model } from "@vetta/ai";
import type {
	AgentPluginRuntimeConfig,
	GreenfieldRuntimeSession,
	RuntimeSessionInputQueueMode,
} from "@vetta/runtime-core";
import type { CodingAgentTurnRetryController, CodingAgentTurnRetrySettings } from "../session-execution/contracts.js";
import type {
	GreenfieldSdkCustomToolDefinition,
	GreenfieldSdkMemoryConfiguration,
	GreenfieldSdkPromptTemplate,
	GreenfieldSdkScopedModel,
	GreenfieldSdkSkillInfo,
} from "./runtime-contracts.js";

export interface CodingAgentGreenfieldSessionCapabilitySettings {
	setDefaultModelAndProvider(provider: string, modelId: string): void;
	setDefaultThinkingLevel(level: string): void;
	setSteeringMode(mode: RuntimeSessionInputQueueMode): void;
	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void;
	getRetryEnabled(): boolean;
	getRetrySettings(): CodingAgentTurnRetrySettings;
	setRetryEnabled(enabled: boolean): void;
}

export interface CodingAgentGreenfieldSessionCapabilityHostOptions {
	readonly readSession: () => GreenfieldRuntimeSession;
	readonly readAvailableModels?: () => Promise<readonly Model<Api>[]>;
	readonly scopedModels?: readonly GreenfieldSdkScopedModel[];
	readonly initialAgentMode?: string;
	readonly settings?: CodingAgentGreenfieldSessionCapabilitySettings;
	readonly retryController?: CodingAgentTurnRetryController;
	readonly reconfigureCustomTools?: (customTools: readonly GreenfieldSdkCustomToolDefinition[] | undefined) => void;
	readonly beforePrompt?: () => Promise<void> | void;
	readonly readSystemPrompt?: () => string;
	readonly readSkills?: () => readonly GreenfieldSdkSkillInfo[];
	readonly readPromptTemplates?: () => readonly GreenfieldSdkPromptTemplate[];
	readonly reconfigureAgentPlugins?: (agentPlugins: AgentPluginRuntimeConfig | undefined) => Promise<void> | void;
	readonly memoryConfiguration?: GreenfieldSdkMemoryConfiguration;
	readonly flushMemory?: (signal?: AbortSignal) => Promise<number>;
	readonly reloadMcp?: () => Promise<void>;
	readonly reload?: () => Promise<void>;
	readonly exportToHtml?: (outputPath?: string) => Promise<string>;
	readonly hasExtensionHandlers?: (eventType: string) => boolean;
}
