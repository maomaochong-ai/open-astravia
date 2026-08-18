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
import type { ToolCallBlockViewProps } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { Component, type ErrorInfo, type ReactNode, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginI18nBoundary } from "../../plugins/runtime/plugin-i18n";
import { MarkdownContent } from "../components/blocks/TextBlock";
import { AskUserQuestionView } from "../components/blocks/tool-views/AskUserQuestionView";
import { BashTerminalCard } from "../components/blocks/tool-views/BashTerminalCard";
import { EditDiffView } from "../components/blocks/tool-views/EditDiffView";
import { KbFilterByTagsView, KbListTagsView, KbWritePageView } from "../components/blocks/tool-views/KnowledgeToolViews";
import { ReadImageView } from "../components/blocks/tool-views/ReadImageView";
import { WriteContentView } from "../components/blocks/tool-views/WriteContentView";
import {
	formatDurationCompact,
	formatDurationPrecise,
	formatPhases,
	formatStartedAt,
} from "../components/blocks/tool-views/shared/format";
import {
	getShellCommand,
	getStringArg,
	parseMcpTool,
	toolIcon,
	toolLabel,
} from "../components/blocks/tool-views/shared/parse-tool";
import { useElapsedWhilePending } from "../components/blocks/tool-views/shared/use-elapsed";

const CONSPICUOUS_DURATION_MS = 1000;

/**
 * 视窗里每一行工具调用都跑一次这个 hook。订阅 activeSessionAtom 整个对象会让
 * session 上任何字段变动都把所有工具行重渲染一遍，这里只需要 runtimeId。
 */
const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);

class PluginToolCallErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}
	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("Plugin tool-call slot failed", error, info.componentStack);
	}
	render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

export type ToolCallBlockModel = ToolCallBlockViewProps;

export function useToolCallBlockModel(block: ToolCallBlock, exportMode = false, aliased = false): ToolCallBlockModel {
	const { t } = useTranslation("chat");
	const [expanded, setExpanded] = useState(false);
	const generatedId = useId();
	const panelId = exportMode ? `export-tool-${generatedId}` : undefined;
	const toolCallSlots = useAtomValue(pluginToolCallSlotsAtom);
	// Subscribe so Work-mode labels re-resolve when language or plugin catalogs change.
	useAtomValue(languageAtom);
	useAtomValue(pluginAgentToolLabelsAtom);
	useAtomValue(pluginI18nByIdAtom);
	const pluginRenderer = useMemo(
		() => toolCallSlots.find((slot) => slot.toolName === block.toolName),
		[toolCallSlots, block.toolName],
	);
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
	const canExpand = hasResult || hasMeta || hasToolSpecificResult;
	const { name, detail } = toolLabel(block, aliased);
	const mcp = parseMcpTool(block.toolName);
	const icon = toolIcon(block.toolName);
	const shellCommand = getShellCommand(block);

	const activeRuntimeId = useAtomValue(activeRuntimeIdAtom);
	const backgroundTasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const backgroundTask = useMemo(() => {
		if (!shellCommand) return undefined;
		const tasks = getBackgroundTasksForSession(backgroundTasksMap, activeRuntimeId);
		return tasks.find((t) => t.toolCallId === block.toolCallId);
	}, [shellCommand, backgroundTasksMap, activeRuntimeId, block.toolCallId]);

	const isPending = block.status === "pending";
	const iconColorClass =
		block.status === "error" || block.isError === true
			? "text-destructive/70"
			: block.status === "success"
				? "text-emerald-500/70"
				: "text-muted-foreground/40";
	const liveElapsedMs = useElapsedWhilePending(block.startedAt, isPending);
	const badgeMs = isPending ? liveElapsedMs : (block.durationMs ?? null);
	const showBadge = badgeMs !== null && badgeMs >= CONSPICUOUS_DURATION_MS;

	if (pluginRenderer) {
		const SlotComponent = pluginRenderer.component;
		// 宿主注入的 md_intro：产物卡片正上方那句由 agent 撰写的说明（见 ADR-0047）。
		const mdIntro = typeof block.args.md_intro === "string" ? block.args.md_intro.trim() : "";
		return {
			canExpand: false,
			expanded: false,
			exportMode,
			icon,
			iconColorClass,
			name,
			isPending,
			showBadge: false,
			body: null,
			onToggle: () => undefined,
			pluginSlot: (
				<>
					{mdIntro ? <MarkdownContent text={mdIntro} className="mb-2" /> : null}
					<PluginToolCallErrorBoundary>
						<PluginI18nBoundary pluginId={pluginRenderer.pluginId}>
							<SlotComponent
							toolCall={{
								toolCallId: block.toolCallId,
								toolName: block.toolName,
								args: block.args,
								status: block.status,
								result: block.result,
								isError: block.isError,
								}}
							/>
						</PluginI18nBoundary>
					</PluginToolCallErrorBoundary>
				</>
			),
		};
	}

	const body = shellCommand ? (
		<BashTerminalCard
			command={shellCommand}
			result={block.result}
			status={block.status}
			isError={block.isError}
			startedAt={block.startedAt}
			durationMs={block.durationMs}
			phases={block.phases}
			backgroundTask={backgroundTask}
		/>
	) : (
		<>
			{hasMeta && block.startedAt !== undefined && (
				<div
					className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/50"
					title={t("toolCall.metaLabel")}
				>
					<span className="font-medium text-muted-foreground/60">{t("toolCall.meta")}</span>
					<span className="tabular-nums">{formatStartedAt(block.startedAt)}</span>
					{block.durationMs !== undefined && (
						<>
							<span className="text-muted-foreground/30">·</span>
							<span className="tabular-nums">{formatDurationPrecise(block.durationMs)}</span>
						</>
					)}
					{block.phases && block.phases.length > 0 && block.durationMs !== undefined && (
						<>
							<span className="text-muted-foreground/30">·</span>
							<span className="break-all">{formatPhases(block.phases, block.durationMs)}</span>
						</>
					)}
				</div>
			)}
			{block.toolName === "read" && block.imagePreview ? (
				<ReadImageView image={block.imagePreview} />
			) : block.toolName === "write" ? (
				<>
					<WriteContentView block={block} />
					{block.isError && block.result && (
						<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-destructive/70">
							{block.result}
						</pre>
					)}
				</>
			) : block.toolName === "edit" ? (
				<>
					<EditDiffView block={block} />
					{block.isError && block.result && (
						<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-destructive/70">
							{block.result}
						</pre>
					)}
				</>
			) : block.toolName === "ask_user_question" ? (
				<AskUserQuestionView block={block} />
			) : block.toolName === "kb_filter_by_tags" ? (
				<KbFilterByTagsView block={block} />
			) : block.toolName === "kb_list_available_tags" ? (
				<KbListTagsView block={block} />
			) : block.toolName === "kb_write_page" ? (
				<KbWritePageView block={block} />
			) : hasResult ? (
				<pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-muted-foreground/60">
					{block.result}
				</pre>
			) : null}
			{block.isError && (
				<div className="mt-1 text-[11px] font-medium text-destructive/70">{t("toolCall.error")}</div>
			)}
		</>
	);

	return {
		canExpand,
		expanded,
		exportMode,
		panelId,
		icon,
		iconColorClass,
		mcpServer: mcp?.server,
		name,
		detail,
		isPending,
		currentPhase: block.currentPhase,
		showBadge,
		badgeLabel: badgeMs !== null ? formatDurationCompact(badgeMs) : null,
		body,
		onToggle: () => setExpanded((v) => !v),
	};
}
