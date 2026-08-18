import { useAgentModeNarration } from "@shared/agent-modes/agent-mode-registry";
import type { ChatMessage, TextBlock } from "@shared/store/atoms";
import {
	activeSessionAtom,
	pluginToolCallSlotsAtom,
	promptPredictingAtom,
	sessionAgentModeAtom,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import {
	findLastProcessBlockIndex,
	getAssistantFoldData,
	groupBlocks,
} from "../components/message-list/messageBlockModel";
import { groupBlocksForWork } from "../components/message-list/progressGroupModel";
import type { AssistantMessageModel } from "../components/message-list/types";

/**
 * 订阅必须切细：这个 hook 每条 assistant 消息都跑一份。直接订阅 activeSessionAtom
 * 整个对象，会让 session 上任何一个字段变动（token 计数、运行状态）都把视窗内所有
 * 消息重渲染一遍，连带重跑 groupBlocks / getAssistantFoldData。
 */
const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);

interface AssistantMessageModelInput {
	expanded: boolean;
	exportMode: boolean;
	isStreaming: boolean;
	isTailMessage: boolean;
	message: ChatMessage;
}

export function useAssistantMessageModel({
	expanded,
	exportMode,
	isStreaming,
	isTailMessage,
	message,
}: AssistantMessageModelInput): AssistantMessageModel {
	const activeRuntimeId = useAtomValue(activeRuntimeIdAtom);
	const toolCallSlots = useAtomValue(pluginToolCallSlotsAtom);
	// 只订阅当前 runtime 的预测位，而不是整张 map——否则任一会话的预测状态变动都会
	// 把这条消息重渲染一遍。
	const isPredictingAtom = useMemo(
		() => selectAtom(promptPredictingAtom, (map) => (activeRuntimeId ? Boolean(map[activeRuntimeId]) : false)),
		[activeRuntimeId],
	);
	const isRuntimePredicting = useAtomValue(isPredictingAtom);
	const customToolNames = useMemo(() => new Set(toolCallSlots.map((slot) => slot.toolName)), [toolCallSlots]);
	const isCurrentlyStreaming = isTailMessage && isStreaming;
	// 按「本会话固化的模式」查注册表的 narration 能力位渲染，不是全局默认值，也不硬编码
	// mode id（新增模式对本渲染层零改动）。未指定模式回退 staged（与历史会话按 work 恢复口径一致）。
	const stagedNarration = useAgentModeNarration(useAtomValue(sessionAgentModeAtom)) === "staged";
	const foldData = useMemo(
		() => getAssistantFoldData(message.blocks ?? [], customToolNames),
		[message.blocks, customToolNames],
	);
	const visibleBlocks = useMemo(() => {
		// 收起时渲染整个答案区（含插件产物卡片），而不是只留文本。
		if (exportMode && foldData) return foldData.answerBlocks;
		if (!foldData || expanded || isCurrentlyStreaming) return message.blocks ?? [];
		return foldData.answerBlocks;
	}, [expanded, exportMode, foldData, isCurrentlyStreaming, message.blocks]);
	const segments = useMemo(
		() =>
			stagedNarration
				? groupBlocksForWork(visibleBlocks, customToolNames, isCurrentlyStreaming)
				: groupBlocks(visibleBlocks, customToolNames),
		[stagedNarration, visibleBlocks, customToolNames, isCurrentlyStreaming],
	);
	// Work 折叠条按「阶段数」计数，而不是 coding 的原始 block 数——用户看到的单位就是阶段。
	const workFoldCount = useMemo(() => {
		if (!stagedNarration || !foldData) return 0;
		const processSegments = groupBlocksForWork(foldData.processBlocks, customToolNames);
		return processSegments.filter((segment) => segment.type === "progress_group" || segment.type === "tool_group")
			.length;
	}, [stagedNarration, foldData, customToolNames]);
	const exportProcessSegments = useMemo(
		() => (exportMode && foldData ? groupBlocks(foldData.processBlocks, customToolNames) : []),
		[customToolNames, exportMode, foldData],
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
		const blocks = message.blocks ?? [];
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
		stagedNarration,
		workFoldCount,
		segments,
		showDuration: Boolean(message.durationSeconds && message.durationSeconds > 0) && !isCurrentlyStreaming,
		streamingTailIndex,
	};
}
