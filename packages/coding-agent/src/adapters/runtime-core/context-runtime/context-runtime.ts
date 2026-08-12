import type { Message, UserMessage } from "@vetta/ai";
import type { ContextCompositionReport } from "@vetta/runtime-core";
import { type ConversationDocument, selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import type {
	ContextCompactionRecord,
	ContextCompositionPublisher,
	ContextPreparationInput,
	ContextStrategy,
	ConversationContinuationResult,
	ManualContextCompactionInput,
	ManualContextCompactionRuntime,
	ModelCallContextTransformationInput,
	ModelCallContextTransformer,
	PreparedContext,
	RuntimeSnapshotAcquireContext,
	StoredSessionEvent,
	TurnObserver,
} from "@vetta/runtime-core/kernel";
import {
	appendCompactionWorkState,
	CompactionCircuitBreaker,
	type CompactionResult,
	type CompactionSettings,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
	shouldPrefire,
} from "../../../compaction/index.js";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../../../model-context/index.js";
import type { CodingAgentCompactionExtensionRuntime } from "../../../runtime-contracts/index.js";
import type { CodingAgentCompactionEntry as CompactionEntry } from "../../../sessions/index.js";
import { CompactionPrefireCache } from "./compaction-prefire-cache.js";
import type {
	CodingAgentContextRuntimeOptions,
	CodingAgentContextUsage,
	CodingAgentModelCallFailureRecovery,
} from "./contracts.js";
import {
	assemblePreparedMessages,
	isOverflowFromCurrentModel,
	isRuntimeMessage,
	projectCompactedHistory,
	removeAssistantMessage,
	toCompactionSessionEntries,
} from "./conversation-compaction-projection.js";
import { CodingAgentImageRequestFailureRecovery, hasImageRetryPlaceholder } from "./image-request-failure-recovery.js";
import { projectModelCallContext } from "./model-call-context-projection.js";

/**
 * Session 唯一的上下文所有者，编排持久化压缩、模型调用投影与提交后的 Hook。
 * 模型调用前的 microcompact 永不直接改写 Conversation Document。
 */
export class CodingAgentContextRuntime
	implements
		ContextStrategy,
		ManualContextCompactionRuntime,
		ModelCallContextTransformer,
		TurnObserver,
		ContextCompositionPublisher
{
	readonly id = "coding-agent.context-runtime";
	private readonly resolveSettings: () => CompactionSettings;
	private readonly generateCompaction: NonNullable<CodingAgentContextRuntimeOptions["generateCompaction"]>;
	private readonly extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined;
	private readonly now: () => number;
	private readonly failureRecovery: CodingAgentModelCallFailureRecovery;
	private readonly circuitBreaker = new CompactionCircuitBreaker();
	private readonly prefire: CompactionPrefireCache;
	private currentTokens = 0;
	private contextComposition: ContextCompositionReport | undefined;
	private autoCompactionEnabledOverride: boolean | undefined;

	constructor(private readonly options: CodingAgentContextRuntimeOptions) {
		this.resolveSettings = options.resolveSettings ?? (() => DEFAULT_COMPACTION_SETTINGS);
		this.generateCompaction =
			options.generateCompaction ??
			((preparation, model, apiKey, customInstructions, signal) =>
				compact(preparation, model, apiKey, customInstructions, signal));
		this.extensionRuntime = options.extensionRuntime;
		this.now = options.now ?? Date.now;
		this.failureRecovery = options.failureRecovery ?? new CodingAgentImageRequestFailureRecovery();
		this.prefire = new CompactionPrefireCache({
			resolveApiKey: options.resolveApiKey,
			generateCompaction: this.generateCompaction,
			canAttempt: () => this.circuitBreaker.canAttempt(),
		});
	}

	initialize(document: ConversationDocument): void {
		this.refreshUsage(document);
	}

	async bindForTurn(context: RuntimeSnapshotAcquireContext): Promise<ContextStrategy & ModelCallContextTransformer> {
		context.signal.throwIfAborted();
		const settings = Object.freeze({ ...this.readSettings() });
		const transformBinding = this.options.bindTransformAgentContext?.(context);
		const extensionRuntime = (await this.extensionRuntime?.bindForTurn?.(context)) ?? this.extensionRuntime;
		let released = false;
		return {
			prepare: (input, signal) => this.prepareWithPolicy(input, signal, settings, extensionRuntime),
			onCompactionCommitted: (record, input, signal, document) =>
				this.onCompactionCommittedWithExtension(record, input, signal, document, extensionRuntime),
			onCompactionContinuationCommitted: (record, input, result, signal) =>
				this.onCompactionContinuationCommittedWithExtension(record, input, result, signal, extensionRuntime),
			onCompactionContinuationFailed: () => this.onCompactionContinuationFailed(),
			transform: (input, signal) =>
				this.transformWith(input, signal, transformBinding?.transform ?? this.options.transformAgentContext),
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

	onDocumentChanged(document: ConversationDocument): void {
		this.refreshUsage(document);
	}

	async prepare(input: ContextPreparationInput, signal: AbortSignal): Promise<PreparedContext> {
		return this.prepareWithPolicy(input, signal, this.readSettings(), this.extensionRuntime);
	}

	private async prepareWithPolicy(
		input: ContextPreparationInput,
		signal: AbortSignal,
		baseSettings: CompactionSettings,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
	): Promise<PreparedContext> {
		signal.throwIfAborted();
		const reason = input.reason ?? "turn_start";
		const model = input.modelBinding?.model;
		const contextWindow = model?.contextWindow ?? input.tokenBudget;
		const settings =
			this.options.memoryRollover?.adjustCompactionSettings(baseSettings, contextWindow) ?? baseSettings;
		if (reason === "assistant_error" && input.triggeringAssistantMessage) {
			const recovery = await this.failureRecovery.recover(
				{
					messages: input.messages,
					assistantMessage: input.triggeringAssistantMessage,
					recoveryAttempt: input.recoveryAttempt ?? 0,
				},
				signal,
			);
			if (recovery) {
				const recoveredTokens = estimateContextTokens(recovery.messages).tokens;
				this.currentTokens = recoveredTokens;
				return { messages: recovery.messages, estimatedTokens: recoveredTokens, retry: true };
			}
		}
		const canRecoverOverflow =
			(input.recoveryAttempt ?? 0) === 0 ||
			((input.recoveryAttempt ?? 0) === 1 && hasImageRetryPlaceholder(input.messages));
		const overflow =
			(reason === "assistant_error" || reason === "assistant_result") &&
			canRecoverOverflow &&
			model !== undefined &&
			isOverflowFromCurrentModel(input.triggeringAssistantMessage, model, contextWindow);
		const callMessages = overflow
			? removeAssistantMessage(input.messages, input.triggeringAssistantMessage)
			: [...input.messages];
		const measuredMessages = reason === "turn_start" ? [...input.historyMessages] : callMessages;
		const estimate = estimateContextTokens(measuredMessages);
		const assembledTokens = estimateContextTokens(callMessages).tokens;
		this.currentTokens = assembledTokens;
		if (reason === "turn_start") return unchanged(callMessages, assembledTokens);
		if (!model || !input.document || contextWindow <= 0 || !settings.enabled) {
			return unchanged(callMessages, assembledTokens);
		}

		const entries = toCompactionSessionEntries(input.compactionSourceDocument ?? input.document);
		if (reason === "assistant_error" && !overflow) return unchanged(callMessages, assembledTokens);
		if (!overflow && !shouldCompact(estimate.tokens, contextWindow, settings)) {
			if (shouldPrefire(estimate.tokens, contextWindow, settings)) {
				this.prefire.start(entries, settings, model, input.modelBinding?.credential);
			}
			return unchanged(callMessages, assembledTokens);
		}
		if (!this.circuitBreaker.canAttempt()) return unchanged(callMessages, assembledTokens);

		const compactionReason = overflow ? "overflow" : "threshold";
		await input.reportObservation({ type: "compaction.start", reason: compactionReason, source: "agent" });
		try {
			const apiKey = input.modelBinding?.credential
				? await input.modelBinding.credential.resolve()
				: await this.options.resolveApiKey(model);
			if (!apiKey) {
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					errorMessage: `No API key for ${model.provider}`,
					source: "agent",
				});
				return unchanged(callMessages, assembledTokens);
			}
			const preparation = prepareCompaction(entries, settings);
			if (!preparation) {
				await input.reportObservation({ type: "compaction.end", success: false, source: "agent" });
				return unchanged(callMessages, assembledTokens);
			}
			const preHookOutcome = await this.options.hookRuntime.runPreCompact("auto", signal);
			if (preHookOutcome.shouldStop || preHookOutcome.shouldBlock) {
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					errorMessage:
						preHookOutcome.stopReason ?? preHookOutcome.blockReason ?? "Compaction blocked by ecosystem hook",
					source: "agent",
				});
				return unchanged(callMessages, assembledTokens);
			}
			await this.options.memoryRollover?.beforeCompaction({ preparation, model, apiKey, signal });

			const extensionResult = await extensionRuntime?.beforeCompaction({
				preparation,
				branchEntries: entries,
				signal,
			});
			if (extensionResult?.cancel) {
				await input.reportObservation({ type: "compaction.end", success: false, source: "agent" });
				return unchanged(callMessages, assembledTokens);
			}
			const prefired = extensionResult?.compaction ? undefined : this.prefire.take(entries);
			const result =
				extensionResult?.compaction ??
				prefired ??
				(await this.generateCompaction(preparation, model, apiKey, undefined, signal));
			signal.throwIfAborted();
			const record = this.toRecord(result, compactionReason, extensionResult?.compaction !== undefined);
			const compactedHistory = projectCompactedHistory(input.document, input.sessionId, input.turnId, record);
			const messages = assemblePreparedMessages(
				compactedHistory,
				input,
				reason,
				compactionReason,
				input.triggeringAssistantMessage,
			);
			const compactedEstimate = estimateContextTokens(messages).tokens;
			this.currentTokens = compactedEstimate;
			return { messages, estimatedTokens: compactedEstimate, compaction: record };
		} catch (error) {
			this.circuitBreaker.recordFailure();
			await input.reportObservation({
				type: "compaction.end",
				success: false,
				errorMessage: error instanceof Error ? error.message : String(error),
				source: "agent",
			});
			return unchanged(callMessages, assembledTokens);
		}
	}

	async onCompactionCommitted(
		record: ContextCompactionRecord,
		_input: ContextPreparationInput,
		signal: AbortSignal,
		document?: ConversationDocument,
	) {
		return this.onCompactionCommittedWithExtension(record, _input, signal, document, this.extensionRuntime);
	}

	private async onCompactionCommittedWithExtension(
		record: ContextCompactionRecord,
		_input: ContextPreparationInput,
		signal: AbortSignal,
		document: ConversationDocument | undefined,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
	) {
		if (!this.options.memoryRollover) {
			return this.finalizeAutomaticCompaction(record, signal, document, extensionRuntime);
		}
		this.options.memoryRollover.beforeContinuation(record);
		return { continueExecution: true, continuation: this.options.memoryRollover.continuationAfterCompaction() };
	}

	async onCompactionContinuationCommitted(
		record: ContextCompactionRecord,
		_input: ContextPreparationInput,
		result: ConversationContinuationResult,
		signal: AbortSignal,
	) {
		return this.onCompactionContinuationCommittedWithExtension(record, _input, result, signal, this.extensionRuntime);
	}

	private onCompactionContinuationCommittedWithExtension(
		record: ContextCompactionRecord,
		_input: ContextPreparationInput,
		result: ConversationContinuationResult,
		signal: AbortSignal,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
	) {
		return this.finalizeAutomaticCompaction(record, signal, result.seedDocument, extensionRuntime, true);
	}

	async onCompactionContinuationFailed(): Promise<void> {
		this.circuitBreaker.recordFailure();
	}

	async compactManual(input: ManualContextCompactionInput, signal: AbortSignal): Promise<ContextCompactionRecord> {
		signal.throwIfAborted();
		const model = input.modelBinding?.model;
		if (!model) throw new Error("No model selected");
		const apiKey = input.modelBinding?.credential
			? await input.modelBinding.credential.resolve()
			: await this.options.resolveApiKey(model);
		if (!apiKey) throw new Error(`No API key for ${model.provider}`);

		const entries = toCompactionSessionEntries(input.document);
		const preparation = prepareCompaction(entries, this.readSettings());
		if (!preparation) {
			const lastEntry = entries[entries.length - 1];
			if (lastEntry?.type === "compaction") throw new Error("Already compacted");
			throw new Error("Nothing to compact (session too small)");
		}

		const preHookOutcome = await this.options.hookRuntime.runPreCompact("manual", signal);
		if (preHookOutcome.shouldStop || preHookOutcome.shouldBlock) {
			throw new Error(preHookOutcome.stopReason ?? preHookOutcome.blockReason ?? "Compaction blocked by hook");
		}
		const extensionResult = await this.extensionRuntime?.beforeCompaction({
			preparation,
			branchEntries: entries,
			customInstructions: input.customInstructions,
			signal,
		});
		if (extensionResult?.cancel) throw new Error("Compaction cancelled");
		const result =
			extensionResult?.compaction ??
			(await this.generateCompaction(preparation, model, apiKey, input.customInstructions, signal));
		if (signal.aborted) throw new Error("Compaction cancelled");
		return this.toRecord(result, "manual", extensionResult?.compaction !== undefined);
	}

	async onManualCompactionCommitted(
		record: ContextCompactionRecord,
		_input: ManualContextCompactionInput,
		signal: AbortSignal,
		document?: ConversationDocument,
	): Promise<void> {
		await this.notifyExtensionCommitted(record, document, this.extensionRuntime);
		await this.options.hookRuntime.runPostCompact("manual", signal);
		this.options.hookRuntime.markSessionStart("compact");
	}

	readAutoCompactionEnabled(): boolean {
		return this.readSettings().enabled;
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.autoCompactionEnabledOverride = enabled;
	}

	async transform(input: ModelCallContextTransformationInput, signal: AbortSignal): Promise<readonly Message[]> {
		return this.transformWith(input, signal, this.options.transformAgentContext);
	}

	private async transformWith(
		input: ModelCallContextTransformationInput,
		signal: AbortSignal,
		transformAgentContext: CodingAgentContextRuntimeOptions["transformAgentContext"],
	): Promise<readonly Message[]> {
		const projected = await projectModelCallContext(input, transformAgentContext, signal);
		this.currentTokens = projected.estimatedTokens;
		return projected.messages;
	}

	async observe(event: StoredSessionEvent): Promise<void> {
		if (event.type !== "message.appended" || event.message.role !== "assistant") return;
		if (event.message.stopReason === "aborted" || event.message.stopReason === "error") return;
		const usage = event.message.usage;
		this.currentTokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	}

	readUsage(contextWindow: number): CodingAgentContextUsage {
		return {
			tokens: this.currentTokens,
			contextWindow,
			percent: contextWindow > 0 ? (this.currentTokens / contextWindow) * 100 : 0,
			...(this.contextComposition ? { composition: this.contextComposition } : {}),
		};
	}

	publishContextComposition(report: ContextCompositionReport): void {
		this.contextComposition = report;
		if (report.phase === "completed" && report.providerReportedInputTokens !== undefined) {
			this.currentTokens = report.providerReportedInputTokens ?? this.currentTokens;
		}
	}

	dispose(): void {
		this.prefire.dispose();
	}

	private toRecord(
		result: CompactionResult,
		reason: ContextCompactionRecord["reason"],
		fromExtension: boolean,
	): ContextCompactionRecord {
		const timestamp = this.now();
		const summary = appendCompactionWorkState(result.summary, this.options.readCompactionWorkState?.());
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

	private refreshUsage(document: ConversationDocument): void {
		this.currentTokens = estimateContextTokens(
			selectConversationDocumentModelMessages(document).filter(isRuntimeMessage),
		).tokens;
	}

	private readSettings(): CompactionSettings {
		const settings = this.resolveSettings();
		return this.autoCompactionEnabledOverride === undefined
			? settings
			: { ...settings, enabled: this.autoCompactionEnabledOverride };
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

	private async finalizeAutomaticCompaction(
		record: ContextCompactionRecord,
		signal: AbortSignal,
		document: ConversationDocument | undefined,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
		allowRemappedFirstKept = false,
	) {
		try {
			await this.notifyExtensionCommitted(record, document, extensionRuntime, allowRemappedFirstKept);
			const outcome = await this.options.hookRuntime.runPostCompact("auto", signal);
			this.options.hookRuntime.markSessionStart("compact");
			this.circuitBreaker.recordSuccess();
			return { continueExecution: !outcome.shouldStop };
		} catch (error) {
			this.circuitBreaker.recordFailure();
			throw error;
		}
	}
}

function unchanged(messages: readonly Message[], estimatedTokens: number): PreparedContext {
	return { messages, estimatedTokens };
}
