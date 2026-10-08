import { providerAuthenticationError } from "@astravia/ai";
import { runtimeFailureFromError } from "@astravia/runtime-core";
import type {
	ConsecutiveFailureCircuitBreaker,
	ContextPreparationInput,
	PreparedContext,
} from "@astravia/runtime-core/kernel";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentContextRuntimeOptions,
	CodingAgentModelCallFailureRecovery,
	CodingAgentPinnedModelContext,
} from "../../runtime-contracts/index.js";
import {
	type CompactionSettings,
	estimateContextTokens,
	getCompactThreshold,
	prepareCompaction,
	shouldCompact,
	shouldPrefire,
} from "../index.js";
import { computePrefireLeadPercent } from "../prefire.js";
import { resolveCompactionSummaryModel } from "../summary-model.js";
import type { CompactionPrefireCache } from "./compaction-prefire-cache.js";
import type { CodingAgentCompactionRecordFactoryOptions } from "./compaction-record-factory.js";
import { createCodingAgentCompactionRecord } from "./compaction-record-factory.js";
import {
	assemblePreparedMessages,
	isOverflowFromCurrentModel,
	projectCompactedHistory,
	removeAssistantMessage,
	toActiveCompactionSessionEntries,
} from "./conversation-compaction-projection.js";
import { hasImageRetryPlaceholder } from "./image-request-failure-recovery.js";
import { projectPinnedConversationDocument } from "./pinned-conversation-projection.js";
import { applyPinnedModelContext } from "./pinned-model-context-projection.js";

export interface CodingAgentAutomaticCompactionStrategyOptions {
	readonly resolveApiKey: CodingAgentContextRuntimeOptions["resolveApiKey"];
	readonly resolveSummaryModel?: CodingAgentContextRuntimeOptions["resolveSummaryModel"];
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
	/** 会话级：上一次模型调用的上下文估算（增速记忆，见调用处注释）。 */
	private lastEstimateTokens: number | undefined;
	constructor(private readonly options: CodingAgentAutomaticCompactionStrategyOptions) {}

	async prepare(
		input: ContextPreparationInput,
		signal: AbortSignal,
		baseSettings: CompactionSettings,
		extensionRuntime: CodingAgentCompactionExtensionRuntime | undefined,
		pinnedContext?: CodingAgentPinnedModelContext,
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
		// 会话级增速记忆：本策略实例随会话存活，最近两次估算之差即最近一轮的
		// 上下文增量——prefire 预热窗口据此自适应（增速快则更早预热）。
		const growthTokens =
			this.lastEstimateTokens !== undefined && estimate.tokens > this.lastEstimateTokens
				? estimate.tokens - this.lastEstimateTokens
				: undefined;
		this.lastEstimateTokens = estimate.tokens;
		if (reason === "turn_start") return unchanged(callMessages, assembledTokens);
		if (!model || !input.document || contextWindow <= 0 || !settings.enabled) {
			return unchanged(callMessages, assembledTokens);
		}

		const entries = toActiveCompactionSessionEntries(
			projectPinnedConversationDocument(input.compactionSourceDocument ?? input.document, pinnedContext),
		);

		if (reason === "assistant_error" && !overflow) return unchanged(callMessages, assembledTokens);
		if (!overflow && !shouldCompact(estimate.tokens, contextWindow, settings)) {
			if (
				shouldPrefire(
					estimate.tokens,
					contextWindow,
					settings,
					computePrefireLeadPercent(growthTokens, contextWindow),
				)
			) {
				void resolveCompactionSummaryModel(model, this.options.resolveSummaryModel).then((resolved) => {
					// 换绑后主模型 credential 不跨 provider；prefire 内部按需 resolveApiKey 兜底。
					const credential = resolved.swapped ? undefined : input.modelBinding?.credential;
					this.options.prefire.start(entries, settings, resolved.model, credential);
				});
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
			// 摘要模型分级：宿主注入解析时换绑到轻量模型；换绑后主模型的
			// modelBinding.credential 不能跨 provider 使用，改走 resolveApiKey。
			const summaryModel = await resolveCompactionSummaryModel(model, this.options.resolveSummaryModel);
			const boundCredential = summaryModel.swapped ? undefined : input.modelBinding?.credential;
			const apiKey = boundCredential
				? await boundCredential.resolve()
				: await this.options.resolveApiKey(summaryModel.model);
			if (!apiKey) {
				await input.reportObservation({
					type: "compaction.end",
					success: false,
					reason: compactionReason,
					errorMessage: `No API key for ${summaryModel.model.provider}`,
					failure: runtimeFailureFromError(
						providerAuthenticationError(
							summaryModel.model,
							`No credentials configured for ${summaryModel.model.provider}/${summaryModel.model.id}`,
						),
					),
					source: "agent",
				});
				return unchanged(callMessages, assembledTokens);
			}
			const preparation = prepareCompaction(entries, settings);
			if (
				!preparation ||
				(preparation.messagesToSummarize.length === 0 && preparation.turnPrefixMessages.length === 0)
			) {
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
			// 摘要生成期间的流式增量：prefire 命中或扩展接管时无增量（后台预热不重发）。
			const result =
				extensionResult?.compaction ??
				prefired ??
				(await this.options.generateCompaction(preparation, summaryModel.model, apiKey, undefined, signal, {
					onSummaryDelta: (text) => input.reportObservation({ type: "compaction.delta", text, source: "agent" }),
				}));
			signal.throwIfAborted();
			const record = createCodingAgentCompactionRecord(
				result,
				compactionReason,
				extensionResult?.compaction !== undefined,
				this.options.recordFactory,
			);
			const compactedHistory = projectCompactedHistory(
				input.document,
				input.sessionId,
				input.turnId,
				record,
				pinnedContext,
			);
			const messages = applyPinnedModelContext(
				assemblePreparedMessages(
					compactedHistory,
					input,
					reason,
					compactionReason,
					input.triggeringAssistantMessage,
				),
				pinnedContext,
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
