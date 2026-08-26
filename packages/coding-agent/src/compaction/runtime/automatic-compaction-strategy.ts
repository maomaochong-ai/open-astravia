import { providerAuthenticationError } from "@vetta/ai";
import { runtimeFailureFromError } from "@vetta/runtime-core";
import type {
	ConsecutiveFailureCircuitBreaker,
	ContextPreparationInput,
	PreparedContext,
} from "@vetta/runtime-core/kernel";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentContextRuntimeOptions,
	CodingAgentModelCallFailureRecovery,
} from "../../runtime-contracts/index.js";
import {
	type CompactionSettings,
	estimateContextTokens,
	getCompactThreshold,
	prepareCompaction,
	shouldCompact,
	shouldPrefire,
} from "../index.js";
import type { CompactionPrefireCache } from "./compaction-prefire-cache.js";
import type { CodingAgentCompactionRecordFactoryOptions } from "./compaction-record-factory.js";
import { createCodingAgentCompactionRecord } from "./compaction-record-factory.js";
import {
	assemblePreparedMessages,
	isOverflowFromCurrentModel,
	projectCompactedHistory,
	removeAssistantMessage,
	toCompactionSessionEntries,
} from "./conversation-compaction-projection.js";
import { hasImageRetryPlaceholder } from "./image-request-failure-recovery.js";

export interface CodingAgentAutomaticCompactionStrategyOptions {
	readonly resolveApiKey: CodingAgentContextRuntimeOptions["resolveApiKey"];
	readonly hookRuntime: CodingAgentContextRuntimeOptions["hookRuntime"];
	readonly memoryRollover: CodingAgentContextRuntimeOptions["memoryRollover"];
	readonly generateCompaction: NonNullable<CodingAgentContextRuntimeOptions["generateCompaction"]>;
	readonly failureRecovery: CodingAgentModelCallFailureRecovery;
	readonly circuitBreaker: ConsecutiveFailureCircuitBreaker;
	readonly prefire: CompactionPrefireCache;
	readonly recordFactory: CodingAgentCompactionRecordFactoryOptions;
	readonly recordEstimatedTokens: (tokens: number) => void;
}

/** Coding-specific automatic compaction policy used behind Runtime Core's ContextStrategy contract. */
export class CodingAgentAutomaticCompactionStrategy {
	constructor(private readonly options: CodingAgentAutomaticCompactionStrategyOptions) {}

	async prepare(
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
			const recovery = await this.options.failureRecovery.recover(
				{
					messages: input.messages,
					assistantMessage: input.triggeringAssistantMessage,
					recoveryAttempt: input.recoveryAttempt ?? 0,
				},
				signal,
			);
			if (recovery) {
				const recoveredTokens = estimateContextTokens(recovery.messages).tokens;
				this.options.recordEstimatedTokens(recoveredTokens);
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
		this.options.recordEstimatedTokens(assembledTokens);
		if (reason === "turn_start") return unchanged(callMessages, assembledTokens);
		if (!model || !input.document || contextWindow <= 0 || !settings.enabled) {
			return unchanged(callMessages, assembledTokens);
		}

		const entries = toCompactionSessionEntries(input.compactionSourceDocument ?? input.document);
		if (reason === "assistant_error" && !overflow) return unchanged(callMessages, assembledTokens);
		if (!overflow && !shouldCompact(estimate.tokens, contextWindow, settings)) {
			if (shouldPrefire(estimate.tokens, contextWindow, settings)) {
				this.options.prefire.start(entries, settings, model, input.modelBinding?.credential);
			}
			return unchanged(callMessages, assembledTokens);
		}
		const compactionReason = overflow ? "overflow" : "threshold";
		await input.reportObservation({
			type: "compaction.start",
			reason: compactionReason,
			contextTokens: estimate.tokens,
			contextWindow,
			thresholdTokens: getCompactThreshold(contextWindow, settings),
			source: "agent",
		});
		if (!this.options.circuitBreaker.canAttempt()) {
			await input.reportObservation({
				type: "compaction.end",
				success: false,
				reason: compactionReason,
				errorMessage: "Compaction circuit breaker is open after repeated failures",
				source: "agent",
			});
			return unchanged(callMessages, assembledTokens);
		}

		try {
			const apiKey = input.modelBinding?.credential
				? await input.modelBinding.credential.resolve()
				: await this.options.resolveApiKey(model);
			if (!apiKey) {
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					reason: compactionReason,
					errorMessage: `No API key for ${model.provider}`,
					failure: runtimeFailureFromError(
						providerAuthenticationError(model, `No credentials configured for ${model.provider}/${model.id}`),
					),
					source: "agent",
				});
				return unchanged(callMessages, assembledTokens);
			}
			const preparation = prepareCompaction(entries, settings);
			if (!preparation) {
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					reason: compactionReason,
					errorMessage: "No eligible history prefix remained after applying the compaction keep-tail policy",
					source: "agent",
				});
				return unchanged(callMessages, assembledTokens);
			}
			const preHookOutcome = await this.options.hookRuntime.runPreCompact("auto", signal);
			if (preHookOutcome.shouldStop || preHookOutcome.shouldBlock) {
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					reason: compactionReason,
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
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					reason: compactionReason,
					errorMessage: "Compaction cancelled by extension",
					source: "agent",
				});
				return unchanged(callMessages, assembledTokens);
			}
			const prefired = extensionResult?.compaction ? undefined : this.options.prefire.take(entries);
			const result =
				extensionResult?.compaction ??
				prefired ??
				(await this.options.generateCompaction(preparation, model, apiKey, undefined, signal));
			signal.throwIfAborted();
			const record = createCodingAgentCompactionRecord(
				result,
				compactionReason,
				extensionResult?.compaction !== undefined,
				this.options.recordFactory,
			);
			const compactedHistory = projectCompactedHistory(input.document, input.sessionId, input.turnId, record);
			const messages = assemblePreparedMessages(
				compactedHistory,
				input,
				reason,
				compactionReason,
				input.triggeringAssistantMessage,
			);
			const compactedEstimate = estimateContextTokens(messages).tokens;
			this.options.recordEstimatedTokens(compactedEstimate);
			return { messages, estimatedTokens: compactedEstimate, compaction: record };
		} catch (error) {
			this.options.circuitBreaker.recordFailure();
			await input.reportObservation({
				type: "compaction.end",
				success: false,
				reason: compactionReason,
				errorMessage: error instanceof Error ? error.message : String(error),
				failure: runtimeFailureFromError(error, { origin: "provider", code: "COMPACTION_FAILED" }),
				source: "agent",
			});
			return unchanged(callMessages, assembledTokens);
		}
	}
}

function unchanged(messages: PreparedContext["messages"], estimatedTokens: number): PreparedContext {
	return { messages, estimatedTokens };
}
