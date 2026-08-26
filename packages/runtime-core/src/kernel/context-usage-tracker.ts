import type { ContextCompositionReport } from "../context-composition/contracts.js";
import type { ConversationDocument } from "../conversation/index.js";
import type { RuntimeDocumentParticipant } from "../runtime-host/runtime-document-participant.js";
import type { ContextCompositionPublisher, StoredSessionEvent, TurnObserver } from "./contracts.js";

export interface RuntimeContextUsage {
	readonly tokens: number;
	readonly contextWindow: number;
	readonly percent: number;
	readonly composition?: ContextCompositionReport;
}

export interface RuntimeContextUsageTrackerOptions {
	readonly estimateDocumentTokens: (document: ConversationDocument) => number;
}

/** Tracks the best available context usage without owning a product's projection or tokenization policy. */
export class RuntimeContextUsageTracker
	implements RuntimeDocumentParticipant, TurnObserver, ContextCompositionPublisher
{
	readonly id = "runtime.context-usage";
	private tokens = 0;
	private composition: ContextCompositionReport | undefined;

	constructor(private readonly options: RuntimeContextUsageTrackerOptions) {}

	initialize(document: ConversationDocument): void {
		this.refreshDocument(document);
	}

	onDocumentChanged(document: ConversationDocument): void {
		this.refreshDocument(document);
	}

	recordEstimatedTokens(tokens: number): void {
		this.tokens = normalizeTokenCount(tokens);
	}

	async observe(event: StoredSessionEvent, _signal?: AbortSignal): Promise<void> {
		if (event.type !== "message.appended" || event.message.role !== "assistant") return;
		if (event.message.stopReason === "aborted" || event.message.stopReason === "error") return;
		const usage = event.message.usage;
		this.tokens = normalizeTokenCount(
			usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
		);
	}

	publishContextComposition(report: ContextCompositionReport): void {
		this.composition = report;
		if (report.phase === "completed" && report.providerReportedInputTokens !== undefined) {
			this.tokens = normalizeTokenCount(report.providerReportedInputTokens ?? this.tokens);
		}
	}

	readUsage(contextWindow: number): RuntimeContextUsage {
		const normalizedWindow = normalizeContextWindow(contextWindow);
		return Object.freeze({
			tokens: this.tokens,
			contextWindow: normalizedWindow,
			percent: normalizedWindow > 0 ? (this.tokens / normalizedWindow) * 100 : 0,
			...(this.composition ? { composition: this.composition } : {}),
		});
	}

	private refreshDocument(document: ConversationDocument): void {
		this.tokens = normalizeTokenCount(this.options.estimateDocumentTokens(document));
	}
}

function normalizeTokenCount(value: number): number {
	if (!Number.isFinite(value) || value < 0)
		throw new Error("Context token count must be a non-negative finite number");
	return value;
}

function normalizeContextWindow(value: number): number {
	if (!Number.isFinite(value) || value < 0) throw new Error("Context window must be a non-negative finite number");
	return value;
}
