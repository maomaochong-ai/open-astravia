import type { Message } from "@vetta/ai";
import { type ContextCompositionReport, RuntimeContextUsageTracker } from "@vetta/runtime-core";
import { type ConversationDocument, selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import {
	ConsecutiveFailureCircuitBreaker,
	type ContextCompactionRecord,
	type ContextCompositionPublisher,
	type ContextPreparationInput,
	type ContextStrategy,
	type ConversationContinuationResult,
	type ManualContextCompactionInput,
	type ManualContextCompactionRuntime,
	type ModelCallContextTransformationInput,
	type ModelCallContextTransformer,
	type PreparedContext,
	type RuntimeSnapshotAcquireContext,
	type StoredSessionEvent,
	type TurnObserver,
} from "@vetta/runtime-core/kernel";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentContextRuntime as CodingAgentContextRuntimeContract,
	CodingAgentContextRuntimeOptions,
	CodingAgentContextUsage,
} from "../../runtime-contracts/index.js";
import { type CompactionSettings, compact, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens } from "../index.js";
import { CodingAgentAutomaticCompactionStrategy } from "./automatic-compaction-strategy.js";
import { CodingAgentCompactionCommitLifecycle } from "./compaction-commit-lifecycle.js";
import { CompactionPrefireCache } from "./compaction-prefire-cache.js";
import { isRuntimeMessage } from "./conversation-compaction-projection.js";
import { CodingAgentImageRequestFailureRecovery } from "./image-request-failure-recovery.js";
import { CodingAgentManualCompactionStrategy } from "./manual-compaction-strategy.js";
import { projectModelCallContext } from "./model-call-context-projection.js";

/**
 * Session-local facade that binds one immutable Turn generation and delegates Coding compaction responsibilities.
 * Runtime Core remains the owner of cancellation, persistence, continuation transactions and Session controls.
 */
export class DefaultCodingAgentContextRuntime
	implements
		CodingAgentContextRuntimeContract,
		ContextStrategy,
		ManualContextCompactionRuntime,
		ModelCallContextTransformer,
		TurnObserver,
		ContextCompositionPublisher
{
	readonly id = "coding-agent.context-runtime";
	private readonly resolveSettings: () => CompactionSettings;
	private readonly extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined;
	private readonly now: () => number;
	private readonly usage: RuntimeContextUsageTracker;
	private readonly prefire: CompactionPrefireCache;
	private readonly automaticCompaction: CodingAgentAutomaticCompactionStrategy;
	private readonly manualCompaction: CodingAgentManualCompactionStrategy;
	private readonly commitLifecycle: CodingAgentCompactionCommitLifecycle;
	private autoCompactionEnabledOverride: boolean | undefined;

	constructor(private readonly options: CodingAgentContextRuntimeOptions) {
		this.resolveSettings = options.resolveSettings ?? (() => DEFAULT_COMPACTION_SETTINGS);
		this.extensionRuntime = options.extensionRuntime;
		this.now = options.now ?? Date.now;
		const generateCompaction =
			options.generateCompaction ??
			((preparation, model, apiKey, customInstructions, signal) =>
				compact(preparation, model, apiKey, customInstructions, signal));
		const circuitBreaker = new ConsecutiveFailureCircuitBreaker({ now: this.now });
		this.usage = new RuntimeContextUsageTracker({
			estimateDocumentTokens: (document) =>
				estimateContextTokens(selectConversationDocumentModelMessages(document).filter(isRuntimeMessage)).tokens,
		});
		this.prefire = new CompactionPrefireCache({
			resolveApiKey: options.resolveApiKey,
			generateCompaction,
			canAttempt: () => circuitBreaker.canAttempt(),
			observations: options.observationPublisher,
		});
		const recordFactory = {
			now: this.now,
			readCompactionWorkState: options.readCompactionWorkState,
		};
		this.automaticCompaction = new CodingAgentAutomaticCompactionStrategy({
			resolveApiKey: options.resolveApiKey,
			hookRuntime: options.hookRuntime,
			memoryRollover: options.memoryRollover,
			generateCompaction,
			failureRecovery: options.failureRecovery ?? new CodingAgentImageRequestFailureRecovery(),
			circuitBreaker,
			prefire: this.prefire,
			recordFactory,
			recordEstimatedTokens: (tokens) => this.usage.recordEstimatedTokens(tokens),
		});
		this.manualCompaction = new CodingAgentManualCompactionStrategy({
			resolveApiKey: options.resolveApiKey,
			hookRuntime: options.hookRuntime,
			generateCompaction,
			readSettings: () => this.readSettings(),
			recordFactory,
		});
		this.commitLifecycle = new CodingAgentCompactionCommitLifecycle({
			hookRuntime: options.hookRuntime,
			memoryRollover: options.memoryRollover,
			circuitBreaker,
		});
	}

	initialize(document: ConversationDocument): void {
		this.usage.initialize(document);
	}

	onDocumentChanged(document: ConversationDocument): void {
		this.usage.onDocumentChanged(document);
	}

	async bindForTurn(context: RuntimeSnapshotAcquireContext): Promise<ContextStrategy & ModelCallContextTransformer> {
		context.signal.throwIfAborted();
		const settings = Object.freeze({ ...this.readSettings() });
		const transformBinding = this.options.bindTransformAgentContext?.(context);
		const extensionRuntime = (await this.extensionRuntime?.bindForTurn?.(context)) ?? this.extensionRuntime;
		const projectionTimeBoundary = this.now();
		let released = false;
		return {
			prepare: (input, signal) => this.automaticCompaction.prepare(input, signal, settings, extensionRuntime),
			onCompactionCommitted: async (record, _input, signal, document) =>
				await this.commitLifecycle.onAutomaticCommitted(record, signal, document, extensionRuntime),
			onCompactionContinuationCommitted: (record, _input, result, signal) =>
				this.commitLifecycle.onContinuationCommitted(record, signal, result.seedDocument, extensionRuntime),
			onCompactionContinuationFailed: async () => this.commitLifecycle.onContinuationFailed(),
			transform: (input, signal) =>
				this.transformWith(
					input,
					signal,
					transformBinding?.transform ?? this.options.transformAgentContext,
					projectionTimeBoundary,
				),
			async releaseTurnBinding() {
				if (released) return;
				released = true;
				const results = await Promise.allSettled([
					extensionRuntime?.releaseTurnBinding?.(),
					transformBinding?.release(),
				]);
				const errors = results
					.filter((result): result is PromiseRejectedResult => result.status === "rejected")
					.map(({ reason }) => reason);
				if (errors.length > 0) throw new AggregateError(errors, "Failed to release Turn-bound context resources");
			},
		};
	}

	prepare(input: ContextPreparationInput, signal: AbortSignal): Promise<PreparedContext> {
		return this.automaticCompaction.prepare(input, signal, this.readSettings(), this.extensionRuntime);
	}

	async onCompactionCommitted(
		record: ContextCompactionRecord,
		_input: ContextPreparationInput,
		signal: AbortSignal,
		document?: ConversationDocument,
	) {
		return this.commitLifecycle.onAutomaticCommitted(record, signal, document, this.extensionRuntime);
	}

	async onCompactionContinuationCommitted(
		record: ContextCompactionRecord,
		_input: ContextPreparationInput,
		result: ConversationContinuationResult,
		signal: AbortSignal,
	) {
		return this.commitLifecycle.onContinuationCommitted(record, signal, result.seedDocument, this.extensionRuntime);
	}

	async onCompactionContinuationFailed(): Promise<void> {
		this.commitLifecycle.onContinuationFailed();
	}

	compactManual(input: ManualContextCompactionInput, signal: AbortSignal): Promise<ContextCompactionRecord> {
		return this.manualCompaction.compact(input, signal, this.extensionRuntime);
	}

	async onManualCompactionCommitted(
		record: ContextCompactionRecord,
		_input: ManualContextCompactionInput,
		signal: AbortSignal,
		document?: ConversationDocument,
	): Promise<void> {
		await this.commitLifecycle.onManualCommitted(record, signal, document, this.extensionRuntime);
	}

	readAutoCompactionEnabled(): boolean {
		return this.readSettings().enabled;
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.autoCompactionEnabledOverride = enabled;
	}

	transform(input: ModelCallContextTransformationInput, signal: AbortSignal): Promise<readonly Message[]> {
		return this.transformWith(input, signal, this.options.transformAgentContext);
	}

	async observe(event: StoredSessionEvent, signal: AbortSignal): Promise<void> {
		await this.usage.observe(event, signal);
	}

	readUsage(contextWindow: number): CodingAgentContextUsage {
		return this.usage.readUsage(contextWindow);
	}

	publishContextComposition(report: ContextCompositionReport): void {
		this.usage.publishContextComposition(report);
	}

	dispose(): void {
		this.prefire.dispose();
	}

	private async transformWith(
		input: ModelCallContextTransformationInput,
		signal: AbortSignal,
		transformAgentContext: CodingAgentContextRuntimeOptions["transformAgentContext"],
		timeBoundary?: number,
	): Promise<readonly Message[]> {
		const projected = await projectModelCallContext(input, transformAgentContext, signal, { timeBoundary });
		this.usage.recordEstimatedTokens(projected.estimatedTokens);
		return projected.messages;
	}

	private readSettings(): CompactionSettings {
		const settings = this.resolveSettings();
		return this.autoCompactionEnabledOverride === undefined
			? settings
			: { ...settings, enabled: this.autoCompactionEnabledOverride };
	}
}

export function createDefaultCodingAgentContextRuntime(
	options: CodingAgentContextRuntimeOptions,
): CodingAgentContextRuntimeContract {
	return new DefaultCodingAgentContextRuntime(options);
}
