import { providerAuthenticationError } from "@vetta/ai";
import type { ContextSummaryInput, ContextSummaryResult } from "@vetta/runtime-core/kernel";
import { createCustomMessage } from "../../model-context/index.js";
import type { CodingAgentContextRuntimeOptions } from "../../runtime-contracts/index.js";
import { type CompactionPreparation, type CompactionSettings, estimateContextTokens } from "../index.js";
import { createFileOps } from "../summary-support.js";

export interface CodingAgentContextSummaryStrategyOptions {
	readonly resolveApiKey: CodingAgentContextRuntimeOptions["resolveApiKey"];
	readonly generateCompaction: NonNullable<CodingAgentContextRuntimeOptions["generateCompaction"]>;
}

/**
 * Generates a summary for an already-authorized immutable record set.
 * It intentionally skips conversation selection, compaction hooks and persistence.
 */
export class CodingAgentContextSummaryStrategy {
	constructor(private readonly options: CodingAgentContextSummaryStrategyOptions) {}

	async summarize(
		input: ContextSummaryInput,
		signal: AbortSignal,
		settings: CompactionSettings,
	): Promise<ContextSummaryResult> {
		signal.throwIfAborted();
		if (input.records.some((record) => record.modelVisible !== true)) {
			throw new Error("Context summary input contains a non-model-visible record");
		}
		const model = input.modelBinding?.model;
		if (!model) throw new Error("No model selected");
		const apiKey = input.modelBinding?.credential
			? await input.modelBinding.credential.resolve()
			: await this.options.resolveApiKey(model);
		if (!apiKey) {
			throw providerAuthenticationError(model, `No credentials configured for ${model.provider}/${model.id}`);
		}

		const messages = input.records.map((record) =>
			createCustomMessage(
				record.type,
				record.content,
				false,
				record.metadata,
				new Date(
					record.timestamp !== undefined && Number.isFinite(record.timestamp) ? record.timestamp : 0,
				).toISOString(),
			),
		);
		if (messages.length === 0) throw new Error("Nothing to summarize");
		const tokensBefore = estimateContextTokens(messages).tokens;
		const preparation: CompactionPreparation = {
			firstKeptEntryId: "transient-context-summary-boundary",
			messagesToSummarize: messages,
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore,
			...(input.previousSummary === undefined ? {} : { previousSummary: input.previousSummary }),
			fileOps: createFileOps(),
			settings,
		};
		const result = await this.options.generateCompaction(
			preparation,
			model,
			apiKey,
			input.customInstructions,
			signal,
		);
		signal.throwIfAborted();
		return {
			summary: result.summary,
			tokensBefore,
			...(result.details === undefined ? {} : { details: result.details }),
		};
	}
}
