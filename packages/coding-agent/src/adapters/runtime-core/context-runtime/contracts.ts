import type { AgentMessage } from "@vetta/agent-core";
import type { Api, AssistantMessage, Message, Model } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter/hooks";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "../../../compaction/index.js";
import type { CompactionWorkStateSnapshot } from "../../../compaction/work-state-recovery.js";
import type { CodingAgentMemoryCompactionPolicy } from "../../../memory/index.js";
import type { CodingAgentCompactionExtensionRuntime } from "../../../runtime-contracts/index.js";

export type ContextHookRuntime = Pick<EcosystemHookRuntime, "markSessionStart" | "runPostCompact" | "runPreCompact">;

export interface CodingAgentModelCallFailureRecoveryInput {
	readonly messages: readonly Message[];
	readonly assistantMessage: AssistantMessage;
	readonly recoveryAttempt: number;
}

export interface CodingAgentModelCallFailureRecoveryResult {
	readonly messages: readonly Message[];
}

export interface CodingAgentModelCallFailureRecovery {
	recover(
		input: CodingAgentModelCallFailureRecoveryInput,
		signal: AbortSignal,
	): Promise<CodingAgentModelCallFailureRecoveryResult | undefined>;
}

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
	readonly failureRecovery?: CodingAgentModelCallFailureRecovery;
	readonly now?: () => number;
	readonly readCompactionWorkState?: () => CompactionWorkStateSnapshot;
}

export interface CodingAgentContextUsage {
	readonly tokens: number;
	readonly contextWindow: number;
	readonly percent: number;
}
