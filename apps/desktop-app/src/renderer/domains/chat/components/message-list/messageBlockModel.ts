import type { ContentBlock, TextBlock, ThinkingBlock, ToolCallBlock } from "@shared/store/atoms";

/** Work 模式的阶段声明工具（display-only，见 docs/adr/0047）。 */
export const PROGRESS_TOOL_NAME = "progress";

export type BlockSegment =
	| { type: "single"; block: ContentBlock }
	| { type: "tool_group"; blocks: (ToolCallBlock | ThinkingBlock)[] }
	/** Work 模式的 progress 调用，在 coding 渲染下降级为一行轻量小标题分隔符。 */
	| { type: "progress_divider"; block: ToolCallBlock };

export interface AssistantFoldData {
	processBlocks: ContentBlock[];
	trailingBlocks: ContentBlock[];
	/**
	 * 收起时渲染的完整答案区（含插件产物卡片与其后的工具调用），而非只有文本。
	 * 插件自定义 UI 工具是作者主动要给用户看的产物，必须活过大折叠。
	 */
	answerBlocks: ContentBlock[];
	/** 答案区中的文本，供复制按钮与 conclusionText 使用。 */
	outputBlocks: TextBlock[];
	hiddenCount: number;
}

function blockKey(block: ContentBlock): string {
	switch (block.type) {
		case "tool_call":
			return `tc-${block.toolCallId}`;
		case "tool_result":
			return `tr-${block.toolCallId}`;
		case "text":
		case "thinking":
		case "error":
			return `${block.type}-${block.id}`;
	}
}

export function segmentKey(segment: BlockSegment): string {
	if (segment.type === "single") return blockKey(segment.block);
	if (segment.type === "progress_divider") return `pd-${segment.block.toolCallId}`;
	return `group-${blockKey(segment.blocks[0])}`;
}

function isCustomToolUiBlock(block: ContentBlock, customToolNames: Set<string>): boolean {
	return block.type === "tool_call" && customToolNames.has(block.toolName);
}

export function groupBlocks(blocks: ContentBlock[], customToolNames: Set<string>): BlockSegment[] {
	const segments: BlockSegment[] = [];
	let batch: (ToolCallBlock | ThinkingBlock)[] = [];
	const flushBatch = (): void => {
		if (batch.length === 0) return;
		segments.push(
			batch.length === 1 ? { type: "single", block: batch[0] } : { type: "tool_group", blocks: [...batch] },
		);
		batch = [];
	};
	for (const block of blocks) {
		if (block.type === "tool_call" && block.toolName === PROGRESS_TOOL_NAME) {
			flushBatch();
			segments.push({ type: "progress_divider", block });
		} else if (isCustomToolUiBlock(block, customToolNames)) {
			flushBatch();
			segments.push({ type: "single", block });
		} else if (block.type === "tool_call" || block.type === "thinking") {
			batch.push(block);
		} else if (block.type === "tool_result") {
		} else if (block.type === "text" && !block.text.trim() && batch.length > 0) {
		} else {
			flushBatch();
			segments.push({ type: "single", block });
		}
	}
	flushBatch();
	return segments;
}

export function findLastProcessBlockIndex(blocks: ContentBlock[], customToolNames: Set<string> = new Set()): number {
	for (let index = blocks.length - 1; index >= 0; index--) {
		const block = blocks[index];
		if (isCustomToolUiBlock(block, customToolNames)) continue;
		if (block.type === "tool_call" || block.type === "thinking") return index;
	}
	return -1;
}

const SHORT_EPILOGUE_MAX_CHARS = 80;
const PRIMARY_ANSWER_MIN_CHARS = 160;

function hasStructuredAnswerContent(text: string): boolean {
	return /```|^\s{0,3}#{1,6}\s|^\s*[-*+]\s|^\s*\d+[.)]\s|\|.+\|/m.test(text);
}

function isShortEpilogueText(blocks: TextBlock[]): boolean {
	if (blocks.length !== 1) return false;
	const text = blocks[0].text.trim();
	return text.length > 0 && text.length <= SHORT_EPILOGUE_MAX_CHARS && !hasStructuredAnswerContent(text);
}

function isMaintenanceToolCall(block: ContentBlock): boolean {
	if (block.type !== "tool_call") return false;
	const toolName = block.toolName.toLowerCase();
	if (!toolName.includes("todo")) return false;
	return block.args.action === "update";
}

function findPreviousPrimaryAnswerIndex(blocks: ContentBlock[], beforeIndex: number): number {
	for (let index = beforeIndex - 1; index >= 0; index--) {
		const block = blocks[index];
		if (block.type === "tool_call" || block.type === "thinking") return -1;
		if (block.type !== "text") continue;
		if (block.text.trim().length >= PRIMARY_ANSWER_MIN_CHARS) return index;
	}
	return -1;
}

export function getAssistantFoldData(blocks: ContentBlock[], customToolNames: Set<string>): AssistantFoldData | null {
	const lastProcessIndex = findLastProcessBlockIndex(blocks, customToolNames);
	if (lastProcessIndex === -1) return null;

	// 答案区起点：默认是最后一个过程块之后；一旦出现插件产物，则退到「该产物之前最后一次
	// 真实工具调用」之后——否则产物上方那段引出它的结论文字会被划进过程区一起折走，产物
	// 就成了没有上下文的孤块。产物之后的过程块因此落进答案区、不再被折叠（见 docs/adr/0047）。
	const firstArtifactIndex = blocks.findIndex((block) => isCustomToolUiBlock(block, customToolNames));
	const answerStart =
		firstArtifactIndex === -1
			? lastProcessIndex + 1
			: Math.min(
					findLastProcessBlockIndex(blocks.slice(0, firstArtifactIndex), customToolNames) + 1,
					lastProcessIndex + 1,
				);
	const answerBlocks = blocks.slice(answerStart);
	const trailingTextBlocks = answerBlocks.filter(
		(block): block is TextBlock => block.type === "text" && block.text.trim().length > 0,
	);
	const hasArtifact = answerBlocks.some((block) => isCustomToolUiBlock(block, customToolNames));
	// 光有产物、没有收尾文字也算有答案，照样值得折叠出来。
	if (trailingTextBlocks.length === 0 && !hasArtifact) return null;

	const lastProcessBlock = blocks[lastProcessIndex];
	// 「todo 收尾 + 一句短跋」的老特例只在没有产物时适用；有产物时分界已由产物决定。
	const primaryAnswerIndex =
		!hasArtifact && isMaintenanceToolCall(lastProcessBlock) && isShortEpilogueText(trailingTextBlocks)
			? findPreviousPrimaryAnswerIndex(blocks, lastProcessIndex)
			: -1;
	if (primaryAnswerIndex !== -1) {
		const primaryAnswerBlock = blocks[primaryAnswerIndex] as TextBlock;
		const outputBlocks = [primaryAnswerBlock, ...trailingTextBlocks];
		const outputBlockSet = new Set<ContentBlock>(outputBlocks);
		const trailingBlocks = blocks.filter((block) => outputBlockSet.has(block));
		return {
			processBlocks: blocks.filter((block) => !outputBlockSet.has(block)),
			trailingBlocks,
			answerBlocks: trailingBlocks,
			outputBlocks,
			hiddenCount: blocks.length - outputBlocks.length,
		};
	}

	// 没有任何东西被折走时不显示折叠条（产物出现在首个工具调用之前时会发生）。
	if (answerStart === 0) return null;

	return {
		processBlocks: blocks.slice(0, answerStart),
		trailingBlocks: answerBlocks,
		answerBlocks,
		outputBlocks: trailingTextBlocks,
		hiddenCount: answerStart,
	};
}
