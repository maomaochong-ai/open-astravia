import { providerAuthenticationError } from "@vetta/ai";
import type { ContextCompactionRecord, ManualContextCompactionInput } from "@vetta/runtime-core/kernel";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentContextRuntimeOptions,
	CodingAgentPinnedModelContext,
} from "../../runtime-contracts/index.js";
import { type CompactionSettings, prepareCompaction } from "../index.js";
import type { CodingAgentCompactionRecordFactoryOptions } from "./compaction-record-factory.js";
import { createCodingAgentCompactionRecord } from "./compaction-record-factory.js";
import { toCompactionSessionEntries } from "./conversation-compaction-projection.js";
import { projectPinnedConversationDocument } from "./pinned-conversation-projection.js";

export interface CodingAgentManualCompactionStrategyOptions {
	readonly resolveApiKey: CodingAgentContextRuntimeOptions["resolveApiKey"];
	readonly hookRuntime: CodingAgentContextRuntimeOptions["hookRuntime"];
	readonly generateCompaction: NonNullable<CodingAgentContextRuntimeOptions["generateCompaction"]>;
	readonly readSettings: () => CompactionSettings;
	readonly recordFactory: CodingAgentCompactionRecordFactoryOptions;
}

/** Coding-specific manual summary generation; Runtime Core owns cancellation and persistence around this call. */
export class CodingAgentManualCompactionStrategy {
	constructor(private readonly options: CodingAgentManualCompactionStrategyOptions) {}

	async compact(
		input: ManualContextCompactionInput,
		signal: AbortSignal,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
		pinnedContext?: CodingAgentPinnedModelContext,
		settings: CompactionSettings = this.options.readSettings(),
	): Promise<ContextCompactionRecord> {
		signal.throwIfAborted();
		const model = input.modelBinding?.model;
		if (!model) throw new Error("No model selected");
		const apiKey = input.modelBinding?.credential
			? await input.modelBinding.credential.resolve()
			: await this.options.resolveApiKey(model);
		if (!apiKey) {
			throw providerAuthenticationError(model, `No credentials configured for ${model.provider}/${model.id}`);
		}

		const entries = toCompactionSessionEntries(projectPinnedConversationDocument(input.document, pinnedContext));
		const preparation = prepareCompaction(entries, settings);
		if (!preparation) {
			const lastEntry = entries[entries.length - 1];
			if (lastEntry?.type === "compaction") throw new Error("Already compacted");
			throw new Error("Nothing to compact (session too small)");
		}

		const preHookOutcome = await this.options.hookRuntime.runPreCompact("manual", signal);
		if (preHookOutcome.shouldStop || preHookOutcome.shouldBlock) {
			throw new Error(preHookOutcome.stopReason ?? preHookOutcome.blockReason ?? "Compaction blocked by hook");
		}
		const extensionResult = await extensionRuntime?.beforeCompaction({
			preparation,
			branchEntries: entries,
			customInstructions: input.customInstructions,
			signal,
		});
		if (extensionResult?.cancel) throw new Error("Compaction cancelled");
		const result =
			extensionResult?.compaction ??
			(await this.options.generateCompaction(preparation, model, apiKey, input.customInstructions, signal));
		if (signal.aborted) throw new Error("Compaction cancelled");
		return createCodingAgentCompactionRecord(
			result,
			"manual",
			extensionResult?.compaction !== undefined,
			this.options.recordFactory,
		);
	}
}
