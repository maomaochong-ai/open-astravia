import type { UserMessage } from "@vetta/ai";
import type { ContextCompactionRecord } from "@vetta/runtime-core/kernel";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../../model-context/index.js";
import type { CodingAgentContextRuntimeOptions } from "../../runtime-contracts/index.js";
import { appendCompactionWorkState, type CompactionResult } from "../index.js";

export interface CodingAgentCompactionRecordFactoryOptions {
	readonly now: () => number;
	readonly readCompactionWorkState: CodingAgentContextRuntimeOptions["readCompactionWorkState"];
}

/** Owns the persisted Coding Agent summary format; Runtime Core treats the record as an opaque domain fact. */
export function createCodingAgentCompactionRecord(
	result: CompactionResult,
	reason: ContextCompactionRecord["reason"],
	fromExtension: boolean,
	options: CodingAgentCompactionRecordFactoryOptions,
): ContextCompactionRecord {
	const timestamp = options.now();
	const summary = appendCompactionWorkState(result.summary, options.readCompactionWorkState?.());
	const summaryMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX }],
		timestamp,
	};
	return {
		summary,
		summaryMessage,
		firstKeptEntryId: result.firstKeptEntryId,
		tokensBefore: result.tokensBefore,
		...(result.details === undefined ? {} : { details: result.details }),
		...(fromExtension ? { fromHook: true } : {}),
		reason,
	};
}
