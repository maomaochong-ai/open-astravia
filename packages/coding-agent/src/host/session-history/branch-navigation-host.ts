import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import { createCodingAgentExtensionSessionView } from "../../adapters/extensions/runtime-session-view-adapter.js";
import { collectEntriesForBranchSummary, generateBranchSummary } from "../../compaction/index.js";
import type { SessionBeforeTreeResult, TreePreparation } from "../../extensions/index.js";
import type { CodingAgentExtensionRunnerPort } from "../../runtime-contracts/index.js";
import type { CodingAgentBranchSummaryEntry as BranchSummaryEntry } from "../../sessions/index.js";
import type { SettingsRuntime } from "../../settings/index.js";

export interface CodingAgentBranchNavigationOptions {
	readonly summarize?: boolean;
	readonly customInstructions?: string;
	readonly replaceInstructions?: boolean;
	readonly label?: string;
}

export interface CodingAgentBranchNavigationHostOptions {
	readonly withActiveSession: <T>(operation: (session: GreenfieldRuntimeSession) => Promise<T>) => Promise<T>;
	readonly readRunner: () => CodingAgentExtensionRunnerPort;
	readonly settingsManager: Pick<SettingsRuntime, "getBranchSummarySettings">;
	readonly generateSummary?: typeof generateBranchSummary;
	readonly clearExecutionContext?: (sessionId: string) => void;
}

/**
 * 保留既有 /tree 的摘要、Extension 事件与标签语义，同时只通过 Runtime Core
 * 历史写端口更新 ConversationDocument。
 */
export class CodingAgentBranchNavigationHost {
	private readonly generateSummary: typeof generateBranchSummary;
	private activeSummaryController: AbortController | undefined;

	constructor(private readonly options: CodingAgentBranchNavigationHostOptions) {
		this.generateSummary = options.generateSummary ?? generateBranchSummary;
	}

	navigateTree(
		targetId: string,
		options: CodingAgentBranchNavigationOptions = {},
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }> {
		return this.options.withActiveSession((session) => this.navigate(session, targetId, options));
	}

	abortBranchSummary(): void {
		this.activeSummaryController?.abort();
	}

	private async navigate(
		session: GreenfieldRuntimeSession,
		targetId: string,
		options: CodingAgentBranchNavigationOptions,
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }> {
		const assembly = session.createCoreAssembly();
		const sessionManager = createCodingAgentExtensionSessionView(assembly);
		const oldLeafId = sessionManager.getLeafId();
		if (targetId === oldLeafId) return { cancelled: false };

		const model = assembly.modelView.readCurrentModel();
		if (options.summarize && !model) throw new Error("No model available for summarization");
		const targetEntry = sessionManager.getEntry(targetId);
		if (!targetEntry) throw new Error(`Entry ${targetId} not found`);

		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			sessionManager,
			oldLeafId,
			targetId,
		);
		let customInstructions = options.customInstructions;
		let replaceInstructions = options.replaceInstructions;
		let label = options.label;
		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
			customInstructions,
			replaceInstructions,
			label,
		};
		const abortController = new AbortController();
		this.activeSummaryController = abortController;
		const runner = this.options.readRunner();

		try {
			let extensionSummary: { summary: string; details?: unknown } | undefined;
			let fromExtension = false;
			if (runner.hasHandlers("session_before_tree")) {
				const result = (await runner.emit({
					type: "session_before_tree",
					preparation,
					signal: abortController.signal,
				})) as SessionBeforeTreeResult | undefined;
				if (result?.cancel) return { cancelled: true };
				if (result?.summary && options.summarize) {
					extensionSummary = result.summary;
					fromExtension = true;
				}
				if (result?.customInstructions !== undefined) customInstructions = result.customInstructions;
				if (result?.replaceInstructions !== undefined) replaceInstructions = result.replaceInstructions;
				if (result?.label !== undefined) label = result.label;
			}

			let summaryText: string | undefined;
			let summaryDetails: unknown;
			if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
				const apiKey = await assembly.modelView.resolveApiKey(model!);
				if (!apiKey) throw new Error(`No API key for ${model!.provider}`);
				const result = await this.generateSummary(entriesToSummarize, {
					model: model!,
					apiKey,
					signal: abortController.signal,
					customInstructions,
					replaceInstructions,
					reserveTokens: this.options.settingsManager.getBranchSummarySettings().reserveTokens,
				});
				if (result.aborted) return { cancelled: true, aborted: true };
				if (result.error) throw new Error(result.error);
				summaryText = result.summary;
				summaryDetails = {
					readFiles: result.readFiles || [],
					modifiedFiles: result.modifiedFiles || [],
				};
			} else if (extensionSummary) {
				summaryText = extensionSummary.summary;
				summaryDetails = extensionSummary.details;
			}

			let newLeafId: string | null;
			let editorText: string | undefined;
			if (targetEntry.type === "message" && targetEntry.message.role === "user") {
				newLeafId = targetEntry.parentId;
				editorText = readTextContent(targetEntry.message.content);
			} else if (targetEntry.type === "custom_message") {
				newLeafId = targetEntry.parentId;
				editorText = readTextContent(targetEntry.content);
			} else {
				newLeafId = targetId;
			}

			let summaryEntry: BranchSummaryEntry | undefined;
			if (summaryText) {
				const appended = await assembly.historyController.appendBranchSummary(
					newLeafId,
					summaryText,
					summaryDetails,
					fromExtension,
				);
				summaryEntry = createCodingAgentExtensionSessionView(session.createCoreAssembly()).getEntry(
					appended.entryId,
				) as BranchSummaryEntry;
				if (label) await assembly.metadataController.setLabel(appended.entryId, label);
			} else {
				await assembly.historyController.navigateForEdit(targetId);
				if (label) await assembly.metadataController.setLabel(targetId, label);
			}
			this.options.clearExecutionContext?.(session.sessionId);

			await runner.emit({
				type: "session_tree",
				newLeafId: createCodingAgentExtensionSessionView(session.createCoreAssembly()).getLeafId(),
				oldLeafId,
				summaryEntry,
				fromExtension: summaryText ? fromExtension : undefined,
			});
			return {
				cancelled: false,
				...(editorText ? { editorText } : {}),
				...(summaryEntry ? { summaryEntry } : {}),
			};
		} finally {
			abortController.abort();
			if (this.activeSummaryController === abortController) this.activeSummaryController = undefined;
		}
	}
}

function readTextContent(content: unknown): string | undefined {
	if (typeof content === "string") return content || undefined;
	if (!Array.isArray(content)) return undefined;
	const text = content
		.map((part) =>
			typeof part === "object" && part !== null && typeof Reflect.get(part, "text") === "string"
				? Reflect.get(part, "text")
				: "",
		)
		.join("");
	return text || undefined;
}
