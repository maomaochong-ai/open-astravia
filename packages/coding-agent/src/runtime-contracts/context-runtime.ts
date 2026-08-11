import type { Api, Model } from "@vetta/ai";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "../compaction/index.js";
import type { CodingAgentCompactionEntry, CodingAgentSessionEntry } from "../sessions/index.js";

export interface CodingAgentCompactionExtensionRuntime {
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
