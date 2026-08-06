import type { AgentMessage } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter/hooks";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "../../../compaction/index.js";
import type { CodingAgentMemoryCompactionPolicy } from "../../../memory/index.js";
import type { CodingAgentCompactionExtensionRuntime } from "../greenfield-compaction-extension-runtime.js";

export type ContextHookRuntime = Pick<EcosystemHookRuntime, "markSessionStart" | "runPostCompact" | "runPreCompact">;

export interface CodingAgentContextRuntimeOptions {
	readonly hookRuntime: ContextHookRuntime;
	readonly resolveApiKey: (model: Model<Api>) => Promise<string | undefined> | string | undefined;
	readonly resolveSettings?: () => CompactionSettings;
	readonly generateCompaction?: (
		preparation: CompactionPreparation,
		model: Model<Api>,
		apiKey: string,
		customInstructions: string | undefined,
		signal: AbortSignal,
	) => Promise<CompactionResult>;
	readonly extensionRuntime?: CodingAgentCompactionExtensionRuntime;
	readonly memoryRollover?: CodingAgentMemoryCompactionPolicy;
	readonly transformAgentContext?: (
		messages: readonly AgentMessage[],
		signal: AbortSignal,
	) => Promise<readonly AgentMessage[]>;
	readonly now?: () => number;
}

export interface CodingAgentContextUsage {
	readonly tokens: number;
	readonly contextWindow: number;
	readonly percent: number;
}
