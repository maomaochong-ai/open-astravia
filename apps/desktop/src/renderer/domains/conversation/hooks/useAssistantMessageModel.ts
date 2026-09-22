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
	const { predicting: isRuntimePredicting } = useAssistantRendering();
	const toolCallSlots = useAtomValue(pluginToolCallSlotsAtom);
	const customToolNames = useMemo(() => new Set(toolCallSlots.map((slot) => slot.toolName)), [toolCallSlots]);
	const presentationToolCallIds = useMemo(
		() => new Set(message.toolCallPresentations?.map((presentation) => presentation.toolCallId) ?? []),
		[message.toolCallPresentations],
	);
	// 已批准的计划在列表里是独立卡片、不并入工具组；但不参与折叠分界（见 pinApprovedPlanBlocks）。
	const standaloneToolCallIds = useMemo(() => {
		const ids = new Set(presentationToolCallIds);
		for (const block of message.blocks) {
			if (block.type === "tool_call" && isApprovedPlanBlock(block)) ids.add(block.toolCallId);
		}
		return ids;
	}, [message.blocks, presentationToolCallIds]);
	const isCurrentlyStreaming =
		message.phase === "pending" ||
		message.phase === "streaming" ||
		(isTailMessage && isStreaming && message.phase !== "failed" && message.phase !== "aborted");
	const foldData = useMemo(
		() => getAssistantFoldData(message.blocks, customToolNames),
		[message.blocks, customToolNames],
	);
	const visibleBlocks = useMemo(() => {
		// 收起时渲染整个答案区（含插件产物卡片），而不是只留文本。
		if (exportMode && foldData) return foldData.answerBlocks;
		if (!foldData || expanded || isCurrentlyStreaming) return message.blocks;
		return pinApprovedPlanBlocks(foldData.processBlocks, foldData.answerBlocks);
	}, [expanded, exportMode, foldData, isCurrentlyStreaming, message.blocks]);
	const segments = useMemo(
		() => groupBlocksForWork(visibleBlocks, customToolNames, isCurrentlyStreaming, standaloneToolCallIds),
		[visibleBlocks, customToolNames, isCurrentlyStreaming, standaloneToolCallIds],
	);
	// 折叠条按「阶段数」计数，而不是原始 block 数——用户看到的单位就是阶段。
	const workFoldCount = useMemo(() => {
		if (!foldData) return 0;
		const processSegments = groupBlocksForWork(
			foldData.processBlocks,
			customToolNames,
			false,
			presentationToolCallIds,
		);
		return processSegments.filter((segment) => segment.type === "progress_group" || segment.type === "tool_group")
			.length;
	}, [foldData, customToolNames, presentationToolCallIds]);
	const exportProcessSegments = useMemo(
		() =>
			exportMode && foldData ? groupBlocks(foldData.processBlocks, customToolNames, presentationToolCallIds) : [],
		[customToolNames, exportMode, foldData, presentationToolCallIds],
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
		if (findLastProcessBlockIndex(blocks, customToolNames) !== -1) return "";
		return blocks
			.filter((block): block is TextBlock => block.type === "text")
			.map((block) => block.text.trim())
			.filter(Boolean)
			.join("\n\n");
	}, [message.blocks, message.text, foldData, customToolNames]);

	return {
		conclusionText,
		exportProcessSegments,
		foldData,
		isCurrentlyStreaming,
		isPredicting: isTailMessage && !isCurrentlyStreaming && isRuntimePredicting,
		liveThinkingId,
		workFoldCount,
		segments,
		durationAvailable: Boolean(message.durationSeconds && message.durationSeconds > 0) && !isCurrentlyStreaming,
		streamingTailIndex,
	};
}
