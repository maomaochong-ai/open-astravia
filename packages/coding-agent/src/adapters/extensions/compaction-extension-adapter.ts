import type { CompactionPreparation, CompactionResult } from "../../compaction/index.js";
import type { SessionBeforeCompactResult } from "../../extensions/index.js";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentExtensionRunnerPort,
} from "../../runtime-contracts/index.js";
import type {
	CodingAgentCompactionEntry as CompactionEntry,
	CodingAgentSessionEntry as SessionEntry,
} from "../../sessions/index.js";

export type { CodingAgentCompactionExtensionRuntime } from "../../runtime-contracts/index.js";

export interface CodingAgentCompactionExtensionInput {
	readonly preparation: CompactionPreparation;
	readonly branchEntries: readonly SessionEntry[];
	readonly customInstructions?: string;
	readonly signal: AbortSignal;
}

export interface CodingAgentCompactionExtensionResult {
	readonly cancel?: boolean;
	readonly compaction?: CompactionResult;
}

export interface CodingAgentCompactionCommittedInput {
	readonly compactionEntry: CompactionEntry;
	readonly fromExtension: boolean;
}

type CompactionExtensionRunner = Pick<CodingAgentExtensionRunnerPort, "emit" | "hasHandlers">;

export function createCodingAgentCompactionExtensionRuntime(
	readRunner: () => CompactionExtensionRunner | undefined,
	captured?: { readonly runner: CompactionExtensionRunner | undefined },
): CodingAgentCompactionExtensionRuntime {
	return {
		bindForTurn() {
			return createCodingAgentCompactionExtensionRuntime(readRunner, { runner: readRunner() });
		},
		async beforeCompaction(input) {
			const runner = captured ? captured.runner : readRunner();
			if (!runner) return undefined;
			if (!runner.hasHandlers("session_before_compact")) return undefined;
			return (await runner.emit({
				type: "session_before_compact",
				preparation: input.preparation,
				branchEntries: [...input.branchEntries],
				customInstructions: input.customInstructions,
				signal: input.signal,
			})) as SessionBeforeCompactResult | undefined;
		},
		async afterCompaction(input) {
			const runner = captured ? captured.runner : readRunner();
			if (!runner) return;
			if (!runner.hasHandlers("session_compact")) return;
			await runner.emit({
				type: "session_compact",
				compactionEntry: input.compactionEntry,
				fromExtension: input.fromExtension,
			});
		},
	};
}
