import { conversationItemRenderKey } from "@shared/conversation";
import type { ContentBlock } from "@shared/store/atoms";
import type { SizeFunction } from "react-virtuoso";
import { isApprovedPlanBlock } from "../../services/plan-review";
import { groupBlocks } from "./messageBlockModel";
import type { ChatConversationItem } from "./types";

const DEFAULT_MESSAGE_COLUMN_WIDTH = 728;
const TEXT_LINE_HEIGHT = 22.4;
const MIN_ITEM_HEIGHT = 64;
const MAX_ITEM_HEIGHT = 8_000;
const MAX_CACHED_MEASUREMENTS = 2_048;
const USER_COLLAPSED_LINE_COUNT = 10;
const COLLAPSED_TOOL_CALL_HEIGHT = 40;
const COLLAPSED_TOOL_GROUP_HEIGHT = 36;
const PROGRESS_DIVIDER_HEIGHT = 32;
const PERSISTENT_TOOL_PRESENTATION_HEIGHT = 180;

interface InferredHeightCacheEntry {
	readonly revision: string;
	readonly height: number;
}

const inferredHeightCache = new WeakMap<object, InferredHeightCacheEntry>();
const itemRevisionCache = new WeakMap<object, string>();
const measuredHeightCache = new Map<string, number>();

function clampHeight(height: number): number {
	return Math.round(Math.min(MAX_ITEM_HEIGHT, Math.max(MIN_ITEM_HEIGHT, height)));
}

function displayUnits(text: string): number {
	let units = 0;
	for (const character of text) {
		if (character === "\t") {
			units += 4;
		} else {
			units += (character.codePointAt(0) ?? 0) > 0xff ? 1.8 : 1;
		}
	}
	return units;
}

function estimateTextLineCount(text: string, width = DEFAULT_MESSAGE_COLUMN_WIDTH): number {
	if (!text) return 0;
	const charactersPerLine = Math.max(32, Math.floor(width / 7.6));
	const sourceLines = text.split("\n");
	let lines = 0;
	let fencedCode = false;
	for (const sourceLine of sourceLines) {
		const trimmed = sourceLine.trimStart();
		if (trimmed.startsWith("```")) {
			fencedCode = !fencedCode;
			lines++;
			continue;
		}
		// Fenced code scrolls horizontally. Ordinary prose and inline code can wrap.
		lines += fencedCode ? 1 : Math.max(1, Math.ceil(displayUnits(sourceLine) / charactersPerLine));
	}
	return lines;
}

function estimateTextHeight(text: string): number {
	const lineCount = estimateTextLineCount(text);
	const paragraphSpacing = Math.min(160, (text.match(/\n\s*\n/g)?.length ?? 0) * 6);
	return lineCount * TEXT_LINE_HEIGHT + paragraphSpacing;
}

function estimateToolCallHeight(
	block: Extract<ContentBlock, { type: "tool_call" }>,
	persistentToolCallIds: ReadonlySet<string>,
): number {
	// Standard tool details are collapsed on first render. Counting hidden diffs, results and
	// previews here made a single row thousands of pixels taller than its visible transcript.
	if (!persistentToolCallIds.has(block.toolCallId)) return COLLAPSED_TOOL_CALL_HEIGHT;
	return PERSISTENT_TOOL_PRESENTATION_HEIGHT;
}

function estimateAgentBlockHeight(block: ContentBlock, persistentToolCallIds: ReadonlySet<string>): number {
	switch (block.type) {
		case "text":
			return 8 + estimateTextHeight(block.text);
		case "thinking":
			return 44;
		case "tool_call":
			return estimateToolCallHeight(block, persistentToolCallIds);
		case "tool_result":
			// Tool results are represented by their tool-call row and are not rendered separately.
			return 0;
		case "error":
			return 56 + Math.min(320, estimateTextHeight(block.text));
	}
}

function estimateAgentBlocksHeight(item: Extract<ChatConversationItem, { kind: "agent" }>): number {
	const persistentToolCallIds = new Set(
		item.toolCallPresentations?.map((presentation) => presentation.toolCallId) ?? [],
	);
	for (const block of item.blocks) {
		if (block.type === "tool_call" && isApprovedPlanBlock(block)) {
			persistentToolCallIds.add(block.toolCallId);
		}
	}
	const segments = groupBlocks(item.blocks, new Set(), persistentToolCallIds);
	return segments.reduce((total, segment) => {
		if (segment.type === "tool_group") return total + COLLAPSED_TOOL_GROUP_HEIGHT;
		if (segment.type === "progress_divider") return total + PROGRESS_DIVIDER_HEIGHT;
		return total + estimateAgentBlockHeight(segment.block, persistentToolCallIds);
	}, 0);
}

function inferMessageItemHeight(item: ChatConversationItem): number {
	const revision = itemRevision(item);
	const cached = inferredHeightCache.get(item);
	if (cached?.revision === revision) return cached.height;

	let height: number;
	if (item.kind === "user") {
		const textHeight = Math.min(USER_COLLAPSED_LINE_COUNT, estimateTextLineCount(item.text)) * TEXT_LINE_HEIGHT;
		const imagesHeight = (item.images?.length ?? 0) > 0 ? 88 : 0;
		const appshotHeight = item.appshot ? 176 : 0;
		const fileCount = (item.mentionedFiles?.length ?? 0) + (item.attachments?.length ?? 0);
		const fileBadgesHeight = fileCount > 0 ? Math.ceil(fileCount / 3) * 24 + 4 : 0;
		const settingsBadgeHeight = item.settingsAssistTabId ? 28 : 0;
		height = 44 + textHeight + imagesHeight + appshotHeight + fileBadgesHeight + settingsBadgeHeight;
	} else if (item.kind === "agent") {
		const blocksHeight =
			item.blocks.length > 0 ? estimateAgentBlocksHeight(item) : estimateTextHeight(item.text ?? "");
		height = 72 + blocksHeight;
	} else {
		const summary = "summary" in item.event && typeof item.event.summary === "string" ? item.event.summary : "";
		height = 56 + Math.min(240, estimateTextHeight(summary));
	}

	const estimate = clampHeight(height);
	inferredHeightCache.set(item, { revision, height: estimate });
	return estimate;
}

function textRevision(text: string | undefined): string {
	if (!text) return "0:0";
	let lineBreaks = 0;
	let hash = 2_166_136_261;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 10) lineBreaks++;
		hash ^= code;
		hash = Math.imul(hash, 16_777_619);
	}
	return `${text.length}:${lineBreaks}:${hash >>> 0}`;
}

function blockRevision(block: ContentBlock): string {
	switch (block.type) {
		case "text":
		case "thinking":
			return `${block.type}:${block.id}:${textRevision(block.text)}`;
		case "tool_call":
			return [
				block.type,
				block.toolCallId,
				block.status,
				textRevision(block.result),
				textRevision(block.uiDetails?.diff),
				block.cards?.length ?? 0,
				block.imagePreviews?.length ?? (block.imagePreview ? 1 : 0),
				block.mcpApp ? 1 : 0,
				block.uiDetails?.planReview?.decision ?? "",
			].join(":");
		case "tool_result":
			return `${block.type}:${block.toolCallId}:${textRevision(block.content)}`;
		case "error":
			return `${block.type}:${block.id}:${textRevision(block.text)}`;
	}
}

function itemRevision(item: ChatConversationItem): string {
	const cached = itemRevisionCache.get(item);
	if (cached !== undefined) return cached;

	let revision: string;
	if (item.kind === "user") {
		revision = [
			item.deliveryPhase,
			textRevision(item.text),
			item.images?.length ?? 0,
			item.appshot ? 1 : 0,
			item.mentionedFiles?.length ?? 0,
			item.attachments?.length ?? 0,
			item.settingsAssistTabId ?? "",
		].join(":");
	} else if (item.kind === "agent") {
		revision = [
			item.phase,
			item.blocks.map(blockRevision).join("|"),
			textRevision(item.text),
			item.toolCallPresentations?.map((presentation) => presentation.toolCallId).join(",") ?? "",
		].join(":");
	} else {
		const summary =
			"summary" in item.event && typeof item.event.summary === "string" ? item.event.summary : undefined;
		revision = `${item.event.kind}:${textRevision(summary)}`;
	}
	itemRevisionCache.set(item, revision);
	return revision;
}

function measurementKey(scope: string | null | undefined, item: ChatConversationItem): string {
	return `${scope ?? "pending"}\u001f${conversationItemRenderKey(item)}\u001f${itemRevision(item)}`;
}

function cacheMeasuredHeight(key: string, height: number): void {
	measuredHeightCache.delete(key);
	measuredHeightCache.set(key, height);
	while (measuredHeightCache.size > MAX_CACHED_MEASUREMENTS) {
		const oldestKey = measuredHeightCache.keys().next().value;
		if (oldestKey === undefined) break;
		measuredHeightCache.delete(oldestKey);
	}
}

export function buildMessageHeightEstimates(
	items: readonly ChatConversationItem[],
	scope: string | null | undefined,
): number[] {
	return items.map((item) => measuredHeightCache.get(measurementKey(scope, item)) ?? inferMessageItemHeight(item));
}

export function createMessageItemSizeRecorder(
	items: readonly ChatConversationItem[],
	scope: string | null | undefined,
): SizeFunction {
	return (element, field) => {
		const size = element[field];
		if (field !== "offsetHeight" || size <= 0) return size;
		const index = Number.parseInt(element.dataset.itemIndex ?? "", 10);
		const item = Number.isInteger(index) ? items[index] : undefined;
		if (item) cacheMeasuredHeight(measurementKey(scope, item), size);
		return size;
	};
}
