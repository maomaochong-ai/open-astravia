import {
	activeSessionAtom,
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	languageAtom,
	pluginAgentToolLabelsAtom,
	pluginI18nByIdAtom,
	pluginToolCallSlotsAtom,
	type ToolCallBlock,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useId, useMemo, useState } from "react";
import { formatDurationCompact } from "../components/blocks/tool-views/shared/format";
import {
	getShellCommand,
	getStringArg,
	parseMcpTool,
	toolCallDurationMs,
	toolCallIconColorClass,
	toolIcon,
	toolLabel,
} from "../components/blocks/tool-views/shared/parse-tool";
import { useElapsedWhilePending } from "../components/blocks/tool-views/shared/use-elapsed";

const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);

export function projectToolCallBlock(block: ToolCallBlock, exportMode = false) {
	const hasResult = block.result !== undefined;
	const hasMeta = block.startedAt !== undefined;
	const hasToolSpecificResult =
		(block.toolName === "write" && getStringArg(block.args, "content") !== null) ||
		(block.toolName === "edit" &&
			(block.uiDetails?.diff !== undefined ||
				getStringArg(block.args, "oldText") !== null ||
				getStringArg(block.args, "newText") !== null ||
				Array.isArray(block.args.edits))) ||
		(block.toolName === "ask_user_question" && Array.isArray(block.args.questions));
	const mcp = parseMcpTool(block.toolName);
	const imagePreviews = block.imagePreviews ?? (block.imagePreview ? [block.imagePreview] : []);

	return {
		exportMode,
		canExpand: hasResult || hasMeta || hasToolSpecificResult,
		hasResult,
		hasMeta,
		icon: toolIcon(block.toolName),
		iconColorClass: toolCallIconColorClass(block.status, block.isError),
		mcpServer: mcp?.server,
		isPending: block.status === "pending",
		currentPhase: block.currentPhase,
		shellCommand: getShellCommand(block),
		imagePreviews,
		showImagePreview: imagePreviews.length > 0 && (block.toolName === "read" || mcp !== null),
		audioPreviews: block.audioPreviews ?? [],
		mdIntro: typeof block.args.md_intro === "string" ? block.args.md_intro.trim() : "",
	};
}

export function useToolCallLabel(block: ToolCallBlock, aliased = false) {
	// Work-mode labels depend on the active language and plugin catalogs.
	useAtomValue(languageAtom);
	useAtomValue(pluginAgentToolLabelsAtom);
	useAtomValue(pluginI18nByIdAtom);
	return toolLabel(block, aliased);
}

export function useToolCallPluginSlot(toolName: string) {
	const toolCallSlots = useAtomValue(pluginToolCallSlotsAtom);
	return useMemo(() => toolCallSlots.find((slot) => slot.toolName === toolName), [toolCallSlots, toolName]);
}

export function useToolCallBackgroundTask(toolCallId: string, shellCommand: string | null) {
	const activeRuntimeId = useAtomValue(activeRuntimeIdAtom);
	const backgroundTasksMap = useAtomValue(backgroundTasksBySessionAtom);
	return useMemo(() => {
		if (!shellCommand) return undefined;
		const tasks = getBackgroundTasksForSession(backgroundTasksMap, activeRuntimeId);
		return tasks.find((task) => task.toolCallId === toolCallId);
	}, [shellCommand, backgroundTasksMap, activeRuntimeId, toolCallId]);
}

export function useToolCallExpansion(exportMode: boolean) {
	const [expanded, setExpanded] = useState(false);
	const generatedId = useId();
	return {
		expanded,
		panelId: exportMode ? `export-tool-${generatedId}` : undefined,
		onToggle: () => setExpanded((value) => !value),
	};
}

export function useToolCallTiming(block: ToolCallBlock) {
	const isPending = block.status === "pending";
	const liveElapsedMs = useElapsedWhilePending(block.startedAt, isPending);
	const badgeMs = toolCallDurationMs(block.status, block.durationMs, liveElapsedMs);
	return {
		badgeAvailable: badgeMs !== null,
		badgeLabel: badgeMs !== null ? formatDurationCompact(badgeMs) : null,
	};
}
