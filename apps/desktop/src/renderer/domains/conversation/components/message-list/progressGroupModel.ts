/**
 * Work 模式的「组渲染」分段模型（见 docs/adr/0047）。
 *
 * Agent 通过 `progress` 工具（滑动窗口契约：一次调用 summary 关闭并改写上一阶段、
 * label 开启新阶段）显式声明阶段边界；本模块把 block 流切成阶段组。
 *
 * 与 coding 模式的 `groupBlocks` 的差别：
 * - 组标题由 agent 写（label 进行中 / summary 完成态），而不是「已完成 N 个工具调用」。
 * - 没有任何 progress 调用时退回启发式合组（连续 tool_call/thinking 合成一组），
 *   标题交给渲染层的通用 i18n 文案。
 * - 硬性例外（插件自定义 UI 工具、error 块）永远冒泡到组外单独渲染；失败的工具调用
 *   不冒泡——work 模式的受众看不懂工具报错，留在阶段组内折叠，展开仍可查看。
 */

import type { ContentBlock, ThinkingBlock, ToolCallBlock } from "@shared/store/atoms";
import { type BlockSegment, PROGRESS_TOOL_NAME } from "./messageBlockModel";

export { PROGRESS_TOOL_NAME };

export type GroupBlock = ToolCallBlock | ThinkingBlock;

export interface ProgressGroupSegment {
	type: "progress_group";
	/** 稳定 key。 */
	id: string;
	/**
	 * 同一逻辑阶段的标识。一个阶段被组外例外块打断后会拆成多个 segment，
	 * 但它们共享 stageId，后续 summary 会同时改写它们的标题。
	 */
	stageId: string;
	/** agent 写的进行中标题；启发式兜底组为 undefined。 */
	label?: string;
	/** agent 写的完成态标题；未关闭的阶段为 undefined。 */
	summary?: string;
	/** 该阶段是否已被显式关闭（后续 progress 的 summary / 正文文本 / 消息结束）。 */
	closed: boolean;
	blocks: GroupBlock[];
}

export type WorkSegment = BlockSegment | ProgressGroupSegment;

function blockKey(block: ContentBlock): string {
	switch (block.type) {
		case "tool_call":
			return `tc-${block.toolCallId}`;
		case "tool_result":
			return `tr-${block.toolCallId}`;
		default:
			return `${block.type}-${block.id}`;
	}
}

export function workSegmentKey(segment: WorkSegment): string {
	if (segment.type === "progress_group") return `pg-${segment.id}`;
	if (segment.type === "single") return blockKey(segment.block);
	if (segment.type === "progress_divider") return `pd-${segment.block.toolCallId}`;
	return `group-${blockKey(segment.blocks[0])}`;
}

function isProgressCall(block: ContentBlock): boolean {
	return block.type === "tool_call" && block.toolName === PROGRESS_TOOL_NAME;
}

function isCustomToolUiBlock(block: ContentBlock, customToolNames: Set<string>): boolean {
	return block.type === "tool_call" && customToolNames.has(block.toolName);
}

function readStringArg(block: ToolCallBlock, key: "label" | "summary"): string | undefined {
	const value = block.args[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 把 block 流切成 work 模式的分段序列。
 * @param blocks 该条 assistant 消息的全部 block。
 * @param customToolNames 插件自定义 UI 工具名（永远组外单独渲染）。
 * @param streaming 该条消息是否仍在流式生成；为 true 时末尾阶段不标记为已关闭。
 */
export function groupBlocksForWork(
	blocks: ContentBlock[],
	customToolNames: Set<string>,
	streaming = false,
): WorkSegment[] {
	const segments: WorkSegment[] = [];
	/** 当前阶段（progress 已开组）；null = 尚未开组，走启发式兜底。 */
	let stage: { id: string; label?: string } | null = null;
	let current: ProgressGroupSegment | null = null;
	let fallback: GroupBlock[] = [];
	let sequence = 0;

	const flushFallback = (): void => {
		if (fallback.length === 0) return;
		if (fallback.length === 1) {
			segments.push({ type: "single", block: fallback[0] });
		} else {
			segments.push({ type: "tool_group", blocks: [...fallback] });
		}
		fallback = [];
	};

	const hasSegmentForStage = (stageId: string): boolean =>
		segments.some((segment) => segment.type === "progress_group" && segment.stageId === stageId);

	const flushCurrent = (): void => {
		if (!current) return;
		// 空组只在该阶段还没有任何 segment 时保留（agent 只报了一句就直接作答）。
		if (current.blocks.length > 0 || !hasSegmentForStage(current.stageId)) segments.push(current);
		current = null;
	};

	const openGroup = (): ProgressGroupSegment | null => {
		if (!stage) return null;
		sequence += 1;
		current = {
			type: "progress_group",
			id: `${stage.id}-${sequence}`,
			stageId: stage.id,
			label: stage.label,
			closed: false,
			blocks: [],
		};
		return current;
	};

	/** 关闭当前阶段：改写同 stageId 的所有 segment 的标题并标记完成。 */
	const closeStage = (summary?: string): void => {
		flushCurrent();
		const stageId = stage?.id;
		stage = null;
		if (!stageId) return;
		for (const segment of segments) {
			if (segment.type !== "progress_group" || segment.stageId !== stageId) continue;
			segment.closed = true;
			if (summary) segment.summary = summary;
		}
	};

	for (const block of blocks) {
		if (block.type === "tool_call" && isProgressCall(block)) {
			const summary = readStringArg(block, "summary");
			const label = readStringArg(block, "label");
			// 首次开组前的裸调用归入启发式兜底组。
			flushFallback();
			closeStage(summary);
			if (label) {
				stage = { id: `stage-${block.toolCallId}`, label };
				openGroup();
			}
			continue;
		}

		if (block.type === "tool_result") continue;

		if (isCustomToolUiBlock(block, customToolNames) || block.type === "error") {
			// 硬性例外：冒泡到组外单独渲染，阶段本身不结束（后续调用回到同一阶段）。
			flushFallback();
			flushCurrent();
			segments.push({ type: "single", block });
			if (stage) openGroup();
			continue;
		}

		if (block.type === "tool_call" || block.type === "thinking") {
			if (stage) {
				const group = current ?? openGroup();
				group?.blocks.push(block);
			} else {
				fallback.push(block);
			}
			continue;
		}

		if (block.type === "text") {
			// 组进行中的空 text 分片不打断分组（与 coding 模式一致）。
			if (!block.text.trim() && (fallback.length > 0 || current !== null)) continue;
			flushFallback();
			closeStage();
			segments.push({ type: "single", block });
		}
	}

	flushFallback();
	// 消息生成完毕时，最终答案隐式关闭最后一个阶段；流式期间保持进行中。
	if (streaming) flushCurrent();
	else closeStage();
	return segments;
}

/** 组是否已跑完：阶段被显式关闭，且组内没有 pending 的工具调用。 */
export function isProgressGroupDone(segment: ProgressGroupSegment): boolean {
	const hasPending = segment.blocks.some((block) => block.type === "tool_call" && block.status === "pending");
	return segment.closed && !hasPending;
}
