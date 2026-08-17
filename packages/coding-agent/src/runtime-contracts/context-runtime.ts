import type { AgentMessage } from "@vetta/agent-core";
import type { Api, AssistantMessage, Message, Model } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter/hooks";
import type { ContextCompositionReport, RuntimeDocumentParticipant } from "@vetta/runtime-core";
import type {
	ContextCompositionPublisher,
	ContextStrategy,
	ManualContextCompactionRuntime,
	ModelCallContextTransformer,
	RuntimeSnapshotAcquireContext,
	TurnObserver,
} from "@vetta/runtime-core/kernel";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "../compaction/index.js";
import type { CompactionWorkStateSnapshot } from "../compaction/work-state-recovery.js";
import type { CodingAgentMemoryCompactionPolicy } from "../memory/index.js";
import type { CodingAgentCompactionEntry, CodingAgentSessionEntry } from "../sessions/index.js";

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
	readonly bindTransformAgentContext?: (context: RuntimeSnapshotAcquireContext) => {
		transform(messages: readonly AgentMessage[], signal: AbortSignal): Promise<readonly AgentMessage[]>;
		release(): Promise<void> | void;
	};
	readonly failureRecovery?: CodingAgentModelCallFailureRecovery;
	readonly now?: () => number;
	readonly readCompactionWorkState?: () => CompactionWorkStateSnapshot;
}

export interface CodingAgentContextUsage {
	readonly tokens: number;
	readonly contextWindow: number;
	readonly percent: number;
	readonly composition?: ContextCompositionReport;
}

export type CodingAgentBoundContextRuntime = Omit<ContextStrategy, "bindForTurn" | "releaseTurnBinding"> &
	Omit<ModelCallContextTransformer, "bindForTurn" | "releaseTurnBinding"> & {
		releaseTurnBinding?(): Promise<void> | void;
	};

/** Session-local Coding Agent context capability consumed through Runtime Core ports. */
export type CodingAgentContextRuntime = Omit<ContextStrategy, "bindForTurn" | "releaseTurnBinding"> &
	ManualContextCompactionRuntime &
	Omit<ModelCallContextTransformer, "bindForTurn" | "releaseTurnBinding"> &
	TurnObserver &
	ContextCompositionPublisher &
	RuntimeDocumentParticipant & {
		readonly id: string;
		bindForTurn?(
			context: RuntimeSnapshotAcquireContext,
		): Promise<CodingAgentBoundContextRuntime> | CodingAgentBoundContextRuntime;
		releaseTurnBinding?(): Promise<void> | void;
		readUsage(contextWindow: number): CodingAgentContextUsage;
		dispose(): void;
	};

export type CodingAgentContextRuntimeFactory = (options: CodingAgentContextRuntimeOptions) => CodingAgentContextRuntime;

export interface CodingAgentCompactionExtensionRuntime {
	bindForTurn?(
		context: RuntimeSnapshotAcquireContext,
	): CodingAgentCompactionExtensionRuntime | Promise<CodingAgentCompactionExtensionRuntime>;
	releaseTurnBinding?(): Promise<void> | void;
	beforeCompaction(input: {
		readonly preparation: CompactionPreparation;
		readonly branchEntries: readonly CodingAgentSessionEntry[];
		readonly customInstructions?: string;
		readonly signal: AbortSignal;
	}): Promise<
		| {
				readonly cancel?: boolean;
				readonly compaction?: CompactionResult;
		  }
		| undefined
	>;
	afterCompaction(input: {
		readonly compactionEntry: CodingAgentCompactionEntry;
		readonly fromExtension: boolean;
	}): Promise<void>;
}

export interface CodingAgentCompactionRuntimeOptions {
	readonly resolveSettings?: () => CompactionSettings;
	readonly generateCompaction?: (
		preparation: CompactionPreparation,
		model: Model<Api>,
		apiKey: string,
		customInstructions: string | undefined,
		signal: AbortSignal,
	) => Promise<CompactionResult>;
}
