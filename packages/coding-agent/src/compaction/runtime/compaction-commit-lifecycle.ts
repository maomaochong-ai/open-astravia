import type { ConversationDocument } from "@vetta/runtime-core/conversation";
import type {
	ConsecutiveFailureCircuitBreaker,
	ContextCompactionCommitResult,
	ContextCompactionFinalizationResult,
	ContextCompactionRecord,
} from "@vetta/runtime-core/kernel";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentContextRuntimeOptions,
} from "../../runtime-contracts/index.js";
import type { CodingAgentCompactionEntry as CompactionEntry } from "../../sessions/index.js";
import { toCompactionSessionEntries } from "./conversation-compaction-projection.js";

export interface CodingAgentCompactionCommitLifecycleOptions {
	readonly hookRuntime: CodingAgentContextRuntimeOptions["hookRuntime"];
	readonly memoryRollover: CodingAgentContextRuntimeOptions["memoryRollover"];
	readonly circuitBreaker: ConsecutiveFailureCircuitBreaker;
}

/** Runs Coding-specific hooks after Runtime Core has durably committed a compaction fact. */
export class CodingAgentCompactionCommitLifecycle {
	constructor(private readonly options: CodingAgentCompactionCommitLifecycleOptions) {}

	onAutomaticCommitted(
		record: ContextCompactionRecord,
		signal: AbortSignal,
		document: ConversationDocument | undefined,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
	): Promise<ContextCompactionCommitResult> | ContextCompactionCommitResult {
		if (!this.options.memoryRollover) return this.finalizeAutomatic(record, signal, document, extensionRuntime);
		this.options.memoryRollover.beforeContinuation(record);
		return { continueExecution: true, continuation: this.options.memoryRollover.continuationAfterCompaction() };
	}

	onContinuationCommitted(
		record: ContextCompactionRecord,
		signal: AbortSignal,
		document: ConversationDocument,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
	): Promise<ContextCompactionFinalizationResult> {
		return this.finalizeAutomatic(record, signal, document, extensionRuntime, true);
	}

	onContinuationFailed(): void {
		this.options.circuitBreaker.recordFailure();
	}

	async onManualCommitted(
		record: ContextCompactionRecord,
		signal: AbortSignal,
		document: ConversationDocument | undefined,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
	): Promise<void> {
		await this.notifyExtensionCommitted(record, document, extensionRuntime);
		await this.options.hookRuntime.runPostCompact("manual", signal);
		this.options.hookRuntime.markSessionStart("compact");
	}

	private async finalizeAutomatic(
		record: ContextCompactionRecord,
		signal: AbortSignal,
		document: ConversationDocument | undefined,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
		allowRemappedFirstKept = false,
	): Promise<ContextCompactionFinalizationResult> {
		try {
			await this.notifyExtensionCommitted(record, document, extensionRuntime, allowRemappedFirstKept);
			const outcome = await this.options.hookRuntime.runPostCompact("auto", signal);
			this.options.hookRuntime.markSessionStart("compact");
			this.options.circuitBreaker.recordSuccess();
			return { continueExecution: !outcome.shouldStop };
		} catch (error) {
			this.options.circuitBreaker.recordFailure();
			throw error;
		}
	}

	private async notifyExtensionCommitted(
		record: ContextCompactionRecord,
		document: ConversationDocument | undefined,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
		allowRemappedFirstKept = false,
	): Promise<void> {
		if (!extensionRuntime || !document) return;
		const entry = [...toCompactionSessionEntries(document)]
			.reverse()
			.find(
				(candidate): candidate is CompactionEntry =>
					candidate.type === "compaction" &&
					candidate.summary === record.summary &&
					(allowRemappedFirstKept || candidate.firstKeptEntryId === record.firstKeptEntryId),
			);
		if (!entry) return;
		await extensionRuntime.afterCompaction({
			compactionEntry: entry,
			fromExtension: record.fromHook === true,
		});
	}
}
