import type { Message } from "@vetta/ai";
import { type ContextCompositionReport, RuntimeContextUsageTracker } from "@vetta/runtime-core";
import { type ConversationDocument, selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import {
	ConsecutiveFailureCircuitBreaker,
	type ContextCompactionRecord,
	type ContextCompositionPublisher,
	type ContextPreparationInput,
	type ContextStrategy,
	type ContextSummaryInput,
	type ContextSummaryResult,
	type ContextSummaryStrategy,
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
	CodingAgentBoundContextRuntime,
	CodingAgentCompactionExtensionRuntime,
	CodingAgentContextRuntime as CodingAgentContextRuntimeContract,
	CodingAgentContextRuntimeOptions,
	CodingAgentContextUsage,
	CodingAgentPinnedModelContext,
} from "../../runtime-contracts/index.js";
import { type CompactionSettings, compact, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens } from "../index.js";
import { CodingAgentAutomaticCompactionStrategy } from "./automatic-compaction-strategy.js";
import { CodingAgentCompactionCommitLifecycle } from "./compaction-commit-lifecycle.js";
import { CompactionPrefireCache } from "./compaction-prefire-cache.js";
import { CodingAgentContextSummaryStrategy } from "./context-summary-strategy.js";
import { isRuntimeMessage } from "./conversation-compaction-projection.js";
import { CodingAgentImageRequestFailureRecovery } from "./image-request-failure-recovery.js";
import { CodingAgentManualCompactionStrategy } from "./manual-compaction-strategy.js";
import { projectModelCallContext } from "./model-call-context-projection.js";
import { requireCodingAgentPinnedModelContext } from "./pinned-model-context-projection.js";

/**
 * Session-local facade that binds one immutable Turn generation and delegates Coding compaction responsibilities.
 * Runtime Core remains the owner of cancellation, persistence, continuation transactions and Session controls.
 */
export class DefaultCodingAgentContextRuntime
	implements
		CodingAgentContextRuntimeContract,
		ContextStrategy,
		ContextSummaryStrategy,
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
	private readonly contextSummary: CodingAgentContextSummaryStrategy;
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
		this.contextSummary = new CodingAgentContextSummaryStrategy({
			resolveApiKey: options.resolveApiKey,
			generateCompaction,
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

	async bindForTurn(context: RuntimeSnapshotAcquireContext): Promise<CodingAgentBoundContextRuntime> {
		context.signal.throwIfAborted();
		const settings = Object.freeze({ ...this.readSettings() });
		const projectionTimeBoundary = this.now();
		const pinnedSource = this.options.bindPinnedModelContext?.(context);
		const pinnedCapture =
			pinnedSource && "then" in pinnedSource
				? pinnedSource.then(requireCodingAgentPinnedModelContext)
				: requireCodingAgentPinnedModelContext(pinnedSource);
		// Every contributor captures before the first await; failures settle before releasing acquired resources.
		const [pinnedResult, extensionResult, transformResult] = await Promise.allSettled([
			pinnedCapture,
			(async () => (await this.extensionRuntime?.bindForTurn?.(context)) ?? this.extensionRuntime)(),
			(async () => this.options.bindTransformAgentContext?.(context))(),
		]);
		const pinnedContext = pinnedResult.status === "fulfilled" ? pinnedResult.value : undefined;
		const extensionRuntime = extensionResult.status === "fulfilled" ? extensionResult.value : undefined;
		const transformBinding = transformResult.status === "fulfilled" ? transformResult.value : undefined;
		let released = false;
		const release = async () => {
			if (released) return;
			released = true;
			const results = await Promise.allSettled([
				Promise.resolve().then(() => extensionRuntime?.releaseTurnBinding?.()),
				Promise.resolve().then(() => transformBinding?.release()),
			]);
			const errors = results
				.filter((result): result is PromiseRejectedResult => result.status === "rejected")
				.map(({ reason }) => reason);
			if (errors.length > 0) throw new AggregateError(errors, "Failed to release Turn-bound context resources");
		};
		try {
			const failures = [pinnedResult, extensionResult, transformResult]
				.filter((result): result is PromiseRejectedResult => result.status === "rejected")
				.map(({ reason }) => reason);
			if (failures.length > 0)
				throw failures.length === 1 ? failures[0] : new AggregateError(failures, "Failed to bind Turn context");
			context.signal.throwIfAborted();
		} catch (error) {
			try {
				await release();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Failed to bind and release Turn context");
			}
			throw error;
		}
		return {
			summarizeContext: (input, signal) => this.contextSummary.summarize(input, signal, settings),
			compactManual: (input, signal) =>
				this.manualCompaction.compact(input, signal, extensionRuntime, pinnedContext, settings),
			onManualCompactionCommitted: (record, _input, signal, document) =>
				this.commitLifecycle.onManualCommitted(record, signal, document, extensionRuntime),
			prepare: (input, signal) =>
				this.automaticCompaction.prepare(input, signal, settings, extensionRuntime, pinnedContext),
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
					pinnedContext,
				),
			releaseTurnBinding: release,
		};
	}

	summarizeContext(input: ContextSummaryInput, signal: AbortSignal): Promise<ContextSummaryResult> {
		return this.contextSummary.summarize(input, signal, this.readSettings());
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
		pinnedContext?: CodingAgentPinnedModelContext,
	): Promise<readonly Message[]> {
		const projected = await projectModelCallContext(input, transformAgentContext, signal, {
			timeBoundary,
			pinnedContext,
		});
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
