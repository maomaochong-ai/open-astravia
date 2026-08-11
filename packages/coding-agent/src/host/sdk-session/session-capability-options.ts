import type { Api, Model } from "@vetta/ai";
import type { AgentPluginRuntimeConfig, RuntimeSession, RuntimeSessionInputQueueMode } from "@vetta/runtime-core";
import type {
	CodingAgentMemoryConfiguration,
	CodingAgentPromptTemplate,
	CodingAgentScopedModel,
	CodingAgentSkillInfo,
} from "../../public-api/sdk/sdk-session-contract.js";
import type { CodingAgentSessionToolDefinition } from "../../public-api/sdk/sdk-tool-contract.js";
import type { CodingAgentTurnRetryController, CodingAgentTurnRetrySettings } from "../session-execution/contracts.js";

export interface CodingAgentSdkSessionCapabilitySettings {
	setDefaultModelAndProvider(provider: string, modelId: string): void;
	setDefaultThinkingLevel(level: string): void;
	setSteeringMode(mode: RuntimeSessionInputQueueMode): void;
	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void;
	getRetryEnabled(): boolean;
	getRetrySettings(): CodingAgentTurnRetrySettings;
	setRetryEnabled(enabled: boolean): void;
}

export interface CodingAgentSdkSessionCapabilityHostOptions {
	readonly readSession: () => RuntimeSession;
	readonly readAvailableModels?: () => Promise<readonly Model<Api>[]>;
	readonly scopedModels?: readonly CodingAgentScopedModel[];
	readonly initialAgentMode?: string;
	readonly settings?: CodingAgentSdkSessionCapabilitySettings;
	readonly retryController?: CodingAgentTurnRetryController;
	readonly reconfigureCustomTools?: (customTools: readonly CodingAgentSessionToolDefinition[] | undefined) => void;
	readonly beforePrompt?: () => Promise<void> | void;
	readonly readSystemPrompt?: () => string;
	readonly readSkills?: () => readonly CodingAgentSkillInfo[];
	readonly readPromptTemplates?: () => readonly CodingAgentPromptTemplate[];
	readonly reconfigureAgentPlugins?: (agentPlugins: AgentPluginRuntimeConfig | undefined) => Promise<void> | void;
	readonly memoryConfiguration?: CodingAgentMemoryConfiguration;
	readonly flushMemory?: (signal?: AbortSignal) => Promise<number>;
	readonly reloadMcp?: () => Promise<void>;
	readonly reload?: () => Promise<void>;
	readonly exportToHtml?: (outputPath?: string) => Promise<string>;
	readonly hasExtensionHandlers?: (eventType: string) => boolean;
}
