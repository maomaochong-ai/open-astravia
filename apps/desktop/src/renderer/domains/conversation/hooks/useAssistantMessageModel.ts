import type { TextBlock } from "@shared/conversation";
import type { ChatAgentMessageViewModel } from "@shared/store/atoms";
import { pluginToolCallSlotsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useAssistantRendering } from "../components/message-list/AssistantRendering";
import {
	findLastProcessBlockIndex,
	getAssistantFoldData,
	groupBlocks,
	selectLiveThinkingId,
} from "../components/message-list/messageBlockModel";
import { groupBlocksForWork } from "../components/message-list/progressGroupModel";
import type { AssistantMessageModel } from "../components/message-list/types";
import { isApprovedPlanBlock, pinApprovedPlanBlocks } from "../services/plan-review";

interface AssistantMessageModelInput {
	expanded: boolean;
	exportMode: boolean;
	isStreaming: boolean;
	isTailMessage: boolean;
	message: ChatAgentMessageViewModel;
}

export function useAssistantMessageModel({
	expanded,
	exportMode,
	isStreaming,
	isTailMessage,
	message,
}: AssistantMessageModelInput): AssistantMessageModel {
	const { narration, predicting: isRuntimePredicting } = useAssistantRendering();
	const toolCallSlots = useAtomValue(pluginToolCallSlotsAtom);
	const customToolNames = useMemo(() => new Set(toolCallSlots.map((slot) => slot.toolName)), [toolCallSlots]);
	const persistentToolCallIds = useMemo(
		() => new Set(message.toolCallPresentations?.map((presentation) => presentation.toolCallId) ?? []),
		[message.toolCallPresentations],
	);
	// 已批准的计划在列表里是独立卡片、不并入工具组；但不参与折叠分界（见 pinApprovedPlanBlocks）。
	const standaloneToolCallIds = useMemo(() => {
		const ids = new Set(persistentToolCallIds);
		for (const block of message.blocks) {
			if (block.type === "tool_call" && isApprovedPlanBlock(block)) ids.add(block.toolCallId);
		}
		return ids;
	}, [message.blocks, persistentToolCallIds]);
	const isCurrentlyStreaming =
		message.phase === "pending" ||
		message.phase === "streaming" ||
		(isTailMessage && isStreaming && message.phase !== "failed" && message.phase !== "aborted");
	// 按「本会话固化的模式」查注册表的 narration 能力位渲染，不是全局默认值，也不硬编码
	// mode id（新增模式对本渲染层零改动）。未指定模式回退 staged（与历史会话按 work 恢复口径一致）。
	const stagedNarration = narration === "staged";
	const foldData = useMemo(
		() => getAssistantFoldData(message.blocks, customToolNames, persistentToolCallIds),
		[message.blocks, customToolNames, persistentToolCallIds],
	);
	const visibleBlocks = useMemo(() => {
		// 收起时渲染整个答案区（含插件产物卡片），而不是只留文本。
		if (exportMode && foldData) return foldData.answerBlocks;
		if (!foldData || expanded || isCurrentlyStreaming) return message.blocks;
		return pinApprovedPlanBlocks(foldData.processBlocks, foldData.answerBlocks);
	}, [expanded, exportMode, foldData, isCurrentlyStreaming, message.blocks]);
	const segments = useMemo(
		() =>
			stagedNarration
				? groupBlocksForWork(visibleBlocks, customToolNames, isCurrentlyStreaming, standaloneToolCallIds)
				: groupBlocks(visibleBlocks, customToolNames, standaloneToolCallIds),
		[stagedNarration, visibleBlocks, customToolNames, isCurrentlyStreaming, standaloneToolCallIds],
	);
	// Work 折叠条按「阶段数」计数，而不是 coding 的原始 block 数——用户看到的单位就是阶段。
	const workFoldCount = useMemo(() => {
		if (!stagedNarration || !foldData) return 0;
		const processSegments = groupBlocksForWork(foldData.processBlocks, customToolNames, false, persistentToolCallIds);
		return processSegments.filter((segment) => segment.type === "progress_group" || segment.type === "tool_group")
			.length;
	}, [stagedNarration, foldData, customToolNames, persistentToolCallIds]);
	const exportProcessSegments = useMemo(
		() => (exportMode && foldData ? groupBlocks(foldData.processBlocks, customToolNames, persistentToolCallIds) : []),
		[customToolNames, exportMode, foldData, persistentToolCallIds],
	);
	const liveThinkingId = useMemo(
		() => selectLiveThinkingId(message.blocks, isCurrentlyStreaming),
		[message.blocks, isCurrentlyStreaming],
	);
	const streamingTailIndex = useMemo(() => {
		if (!isCurrentlyStreaming) return -1;
		for (let index = segments.length - 1; index >= 0; index--) {
			const segment = segments[index];
			if (segment.type === "single" && segment.block.type === "text" && segment.block.text.length > 0) {
				return index;
			}
		}
		return -1;
	}, [segments, isCurrentlyStreaming]);
	// foldData 上面已经算过一遍，这里复用；deps 也收窄到 blocks/text，
	// 否则 message 引用一变（流式每帧都变）就整段重算。
	const conclusionText = useMemo(() => {
		const blocks = message.blocks;
		if (blocks.length === 0) return (message.text ?? "").trim();
		if (foldData) {
			return foldData.outputBlocks
				.map((block) => block.text.trim())
				.filter(Boolean)
				.join("\n\n");
		}
		if (findLastProcessBlockIndex(blocks, customToolNames, persistentToolCallIds) !== -1) return "";
		return blocks
			.filter((block): block is TextBlock => block.type === "text")
			.map((block) => block.text.trim())
			.filter(Boolean)
			.join("\n\n");
	}, [message.blocks, message.text, foldData, customToolNames, persistentToolCallIds]);

	return {
		conclusionText,
		exportProcessSegments,
		foldData,
		isCurrentlyStreaming,
		isPredicting: isTailMessage && !isCurrentlyStreaming && isRuntimePredicting,
		liveThinkingId,
		stagedNarration,
		workFoldCount,
		segments,
		durationAvailable: Boolean(message.durationSeconds && message.durationSeconds > 0) && !isCurrentlyStreaming,
		streamingTailIndex,
	};
}
