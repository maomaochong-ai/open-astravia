import { SegmentShell, ToolCallGroupView } from "@vetta/theme-ui/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBlockView } from "../blocks/ErrorBlock";
import { TextBlockView } from "../blocks/TextBlock";
import { ThinkingBlockView } from "../blocks/ThinkingBlock";
import { ToolCallBlockView } from "../blocks/ToolCallBlock";
import type { BlockSegment } from "./messageBlockModel";

export {
	findLastProcessBlockIndex,
	getAssistantFoldData,
	groupBlocks,
	segmentKey,
} from "./messageBlockModel";
export type { AssistantFoldData, BlockSegment } from "./messageBlockModel";

/** Local block shapes (avoid @shared/store dataHeavy misclassification). */
interface ToolLike {
	type: "tool_call";
	toolCallId: string;
	status: string;
}
interface ThinkingLike {
	type: "thinking";
	id: string;
	text: string;
}
type GroupBlock = ToolLike | ThinkingLike;

const ToolCallGroup = memo(function ToolCallGroup({
	blocks,
	exportMode = false,
}: {
	blocks: GroupBlock[];
	exportMode?: boolean;
}) {
	const { t } = useTranslation("chat");
	const toolBlocks = blocks.filter((block): block is ToolLike => block.type === "tool_call");
	const thinkingCount = blocks.filter((block) => block.type === "thinking").length;
	const completedCount = toolBlocks.filter((block) => block.status !== "pending").length;
	const allDone = completedCount === toolBlocks.length;
	const summary: string[] = [];
	if (toolBlocks.length > 0) {
		summary.push(
			allDone
				? t("messageList.toolCallGroup.completed", { count: completedCount })
				: t("messageList.toolCallGroup.inProgress", {
						completed: completedCount,
						total: toolBlocks.length,
					}),
		);
	}
	if (thinkingCount > 0) {
		summary.push(t("messageList.toolCallGroup.thinking", { count: thinkingCount }));
	}

	return (
		<ToolCallGroupView
			blockCount={blocks.length}
			summary={summary.join("，")}
			allDone={allDone}
			exportMode={exportMode}
		>
			{blocks.map((block) =>
				block.type === "tool_call" ? (
					// biome-ignore lint/suspicious/noExplicitAny: host ToolCallBlockView expects full atom type
					<ToolCallBlockView key={block.toolCallId} block={block as any} exportMode={exportMode} />
				) : (
					<ThinkingBlockView key={`thinking-${block.id}`} text={block.text} exportMode={exportMode} />
				),
			)}
		</ToolCallGroupView>
	);
});

/**
 * Work 模式的 progress 调用在 coding 渲染下的降级形态：一行语义分隔小标题，
 * 下方仍然平铺完整工具卡片，coding 的信息密度不损失。
 */
function ProgressDivider({ block }: { block: { args: Record<string, unknown> } }): JSX.Element | null {
	const label = typeof block.args.label === "string" ? block.args.label.trim() : "";
	const summary = typeof block.args.summary === "string" ? block.args.summary.trim() : "";
	const text = label || summary;
	if (!text) return null;
	return (
		<div className="flex items-center gap-2 px-1 pt-1.5 pb-0.5">
			<span className="icon-[mdi--flag-outline] h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
			<span className="min-w-0 truncate text-[12px] font-medium text-muted-foreground/70">{text}</span>
			<span className="h-px min-w-4 flex-1 bg-border/60" />
		</div>
	);
}

interface SegmentRendererProps {
	segment: BlockSegment;
	isStreamingTail?: boolean;
	animateIn?: boolean;
	exportMode?: boolean;
}

function areSegmentsEqual(previous: BlockSegment, next: BlockSegment): boolean {
	if (previous.type === "single") {
		return next.type === "single" && previous.block === next.block;
	}
	if (previous.type === "progress_divider") {
		return next.type === "progress_divider" && previous.block === next.block;
	}
	if (next.type !== "tool_group" || previous.blocks.length !== next.blocks.length) {
		return false;
	}
	return previous.blocks.every((block, index) => block === next.blocks[index]);
}

function areSegmentRendererPropsEqual(
	previous: SegmentRendererProps,
	next: SegmentRendererProps,
): boolean {
	return (
		previous.isStreamingTail === next.isStreamingTail &&
		previous.animateIn === next.animateIn &&
		previous.exportMode === next.exportMode &&
		areSegmentsEqual(previous.segment, next.segment)
	);
}

export const SegmentRenderer = memo(function SegmentRenderer({
	segment,
	isStreamingTail = false,
	animateIn = false,
	exportMode = false,
}: SegmentRendererProps) {
	let content: JSX.Element | null;
	if (segment.type === "tool_group") {
		content = <ToolCallGroup blocks={segment.blocks as GroupBlock[]} exportMode={exportMode} />;
	} else if (segment.type === "progress_divider") {
		content = <ProgressDivider block={segment.block} />;
	} else {
		switch (segment.block.type) {
			case "text":
				content = (
					<TextBlockView text={segment.block.text} isStreamingTail={isStreamingTail} />
				);
				break;
			case "thinking":
				content = (
					<ThinkingBlockView text={segment.block.text} exportMode={exportMode} />
				);
				break;
			case "tool_call":
				content = <ToolCallBlockView block={segment.block} exportMode={exportMode} />;
				break;
			case "error":
				content = <ErrorBlockView block={segment.block} exportMode={exportMode} />;
				break;
			default:
				content = null;
		}
	}

	return <SegmentShell animateIn={animateIn}>{content}</SegmentShell>;
}, areSegmentRendererPropsEqual);
