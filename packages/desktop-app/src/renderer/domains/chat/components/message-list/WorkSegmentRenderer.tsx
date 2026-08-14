import type { ThinkingBlock, ToolCallBlock } from "@shared/store/atoms";
import { languageAtom, pluginAgentToolLabelsAtom, pluginI18nByIdAtom } from "@shared/store/atoms";
import { ProgressGroupRow, ProgressGroupView, SegmentShell } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBlockView } from "../blocks/ErrorBlock";
import { TextBlockView } from "../blocks/TextBlock";
import { ThinkingBlockView } from "../blocks/ThinkingBlock";
import { ToolCallBlockView } from "../blocks/ToolCallBlock";
import { toolLabel } from "../blocks/tool-views/shared/parse-tool";
import { useExpansion } from "./expansionStore";
import type { GroupBlock, ProgressGroupSegment, WorkSegment } from "./progressGroupModel";
import { isProgressGroupDone } from "./progressGroupModel";

/** Row text: prefer the agent-authored per-call reason, fall back to tool name + main arg. */
function rowText(block: ToolCallBlock): string {
	const description = block.args.description;
	if (typeof description === "string" && description.trim()) return description.trim();
	const { name, detail } = toolLabel(block, true);
	return detail ? `${name} · ${detail}` : name;
}

interface StageRowProps {
	block: ToolCallBlock;
	exportMode: boolean;
}

const StageRow = memo(function StageRow({ block, exportMode }: StageRowProps) {
	const [expanded, toggle] = useExpansion(`row:${block.toolCallId}`);
	// Re-resolve plugin tool labels when language / catalogs / registrations change.
	useAtomValue(languageAtom);
	useAtomValue(pluginAgentToolLabelsAtom);
	useAtomValue(pluginI18nByIdAtom);
	return (
		<ProgressGroupRow
			text={rowText(block)}
			status={block.status}
			exportMode={exportMode}
			expanded={expanded}
			onToggle={toggle}
			details={<ToolCallBlockView block={block} exportMode={exportMode} aliased />}
		/>
	);
});

interface StageGroupProps {
	segment: ProgressGroupSegment;
	fallbackTitle: string;
	exportMode: boolean;
}

const StageGroup = memo(function StageGroup({ segment, fallbackTitle, exportMode }: StageGroupProps) {
	const [expanded, toggle] = useExpansion(`stage:${segment.id}`);
	const { t } = useTranslation("chat");
	return (
		<ProgressGroupView
			title={segment.summary ?? segment.label ?? fallbackTitle}
			blockCount={segment.blocks.length}
			done={isProgressGroupDone(segment)}
			exportMode={exportMode}
			expanded={expanded}
			onToggle={toggle}
		>
			{/* thinking 与工具调用按原顺序同列，展开阶段后才可见。 */}
			{segment.blocks.map((block) =>
				block.type === "tool_call" ? (
					<StageRow key={block.toolCallId} block={block} exportMode={exportMode} />
				) : (
					<ThinkingBlockView
						key={`thinking-${block.id}`}
						text={block.text}
						exportMode={exportMode}
						title={t("messageList.progressGroup.thinking")}
						showLineCount={false}
					/>
				),
			)}
		</ProgressGroupView>
	);
});

interface WorkSegmentRendererProps {
	segment: WorkSegment;
	isStreamingTail?: boolean;
	animateIn?: boolean;
	exportMode?: boolean;
}

function areBlocksEqual(previous: GroupBlock[], next: GroupBlock[]): boolean {
	return previous.length === next.length && previous.every((block, index) => block === next[index]);
}

function arePropsEqual(previous: WorkSegmentRendererProps, next: WorkSegmentRendererProps): boolean {
	if (
		previous.isStreamingTail !== next.isStreamingTail ||
		previous.animateIn !== next.animateIn ||
		previous.exportMode !== next.exportMode
	) {
		return false;
	}
	const a = previous.segment;
	const b = next.segment;
	if (a.type !== b.type) return false;
	if (a.type === "single") return b.type === "single" && a.block === b.block;
	if (a.type === "tool_group") return b.type === "tool_group" && areBlocksEqual(a.blocks, b.blocks as GroupBlock[]);
	if (a.type === "progress_divider") return b.type === "progress_divider" && a.block === b.block;
	const other = b as ProgressGroupSegment;
	return (
		a.label === other.label &&
		a.summary === other.summary &&
		a.closed === other.closed &&
		areBlocksEqual(a.blocks, other.blocks)
	);
}

/**
 * Work-mode segment renderer. Stages carry agent-authored titles; thinking is
 * never shown; errors and plugin tool cards were already bubbled out of the
 * stages by `groupBlocksForWork`.
 */
export const WorkSegmentRenderer = memo(function WorkSegmentRenderer({
	segment,
	isStreamingTail = false,
	animateIn = false,
	exportMode = false,
}: WorkSegmentRendererProps) {
	const { t } = useTranslation("chat");
	let content: JSX.Element | null;

	if (segment.type === "progress_divider") {
		// Work 渲染下 progress 本身不成卡片，标题已由所属阶段承载。
		content = null;
	} else if (segment.type === "progress_group") {
		content = (
			<StageGroup
				segment={segment}
				fallbackTitle={t("messageList.progressGroup.fallbackTitle")}
				exportMode={exportMode}
			/>
		);
	} else if (segment.type === "tool_group") {
		// No progress call in this message: heuristic grouping with a generic title.
		const blocks = segment.blocks as (ToolCallBlock | ThinkingBlock)[];
		const toolBlocks = blocks.filter((block): block is ToolCallBlock => block.type === "tool_call");
		const done = toolBlocks.every((block) => block.status !== "pending");
		const firstThinking = blocks.find((block): block is ThinkingBlock => block.type === "thinking");
		content = (
			<StageGroup
				segment={{
					type: "progress_group",
					// 兜底组没有 progress 调用可依附，用首个 block 的 id 保证展开态 key 稳定且不串。
					id: `heuristic-${toolBlocks[0]?.toolCallId ?? firstThinking?.id ?? "empty"}`,
					stageId: "heuristic",
					closed: done,
					blocks,
				}}
				fallbackTitle={
					// 纯 thinking 的兜底组不该说「完成了 0 步操作」。
					toolBlocks.length === 0
						? t("messageList.progressGroup.thinking")
						: done
							? t("messageList.progressGroup.genericDone", { count: toolBlocks.length })
							: t("messageList.progressGroup.genericRunning")
				}
				exportMode={exportMode}
			/>
		);
	} else {
		switch (segment.block.type) {
			case "text":
				content = <TextBlockView text={segment.block.text} isStreamingTail={isStreamingTail} />;
				break;
			case "thinking":
				// 组外的裸 thinking（阶段尚未开组）：同样只报「正在思考」，不报行数。
				content = (
					<ThinkingBlockView
						text={segment.block.text}
						exportMode={exportMode}
						title={t("messageList.progressGroup.thinking")}
						showLineCount={false}
					/>
				);
				break;
			case "tool_call":
				content = <ToolCallBlockView block={segment.block} exportMode={exportMode} aliased />;
				break;
			case "error":
				content = <ErrorBlockView block={segment.block} exportMode={exportMode} />;
				break;
			default:
				content = null;
		}
	}

	return <SegmentShell animateIn={animateIn}>{content}</SegmentShell>;
}, arePropsEqual);
