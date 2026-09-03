import type { ToolCallBlock } from "@shared/store/atoms";
import { ToolCall } from "@vetta/theme-ui/chat";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PluginI18nBoundary } from "../../../plugins/runtime/plugin-i18n";
import {
	projectToolCallBlock,
	useToolCallBackgroundTask,
	useToolCallExpansion,
	useToolCallLabel,
	useToolCallPluginSlot,
	useToolCallTiming,
} from "../../hooks/useToolCallBlockCapabilities";
import { McpAppSurface } from "../mcp-app/McpAppSurface";
import { MarkdownContent } from "./TextBlock";
import { AskUserQuestionView } from "./tool-views/AskUserQuestionView";
import { BashTerminalCard } from "./tool-views/BashTerminalCard";
import { EditDiffView } from "./tool-views/EditDiffView";
import { KbFilterByTagsView, KbListTagsView, KbWritePageView } from "./tool-views/KnowledgeToolViews";
import { ReadImageView } from "./tool-views/ReadImageView";
import { WriteContentView } from "./tool-views/WriteContentView";
import { formatDurationPrecise, formatPhases, formatStartedAt } from "./tool-views/shared/format";

interface ToolCallBlockProps {
	block: ToolCallBlock;
	exportMode?: boolean;
	/** Work 模式传 true：工具名走 i18n 语义别名。 */
	aliased?: boolean;
}

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

function PluginToolCallContent({
	block,
	mdIntro,
	pluginSlot,
}: {
	block: ToolCallBlock;
	mdIntro: string;
	pluginSlot: NonNullable<ReturnType<typeof useToolCallPluginSlot>>;
}) {
	const SlotComponent = pluginSlot.component;
	return (
		<>
			{mdIntro ? <MarkdownContent text={mdIntro} className="mb-2" /> : null}
			<PluginToolCallErrorBoundary>
				<PluginI18nBoundary pluginId={pluginSlot.pluginId}>
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
	);
}

function ToolCallContent({
	block,
	exportMode,
	backgroundTask,
}: {
	block: ToolCallBlock;
	exportMode: boolean;
	backgroundTask: ReturnType<typeof useToolCallBackgroundTask>;
}) {
	const { t } = useTranslation("chat");
	const projection = projectToolCallBlock(block, exportMode);

	if (projection.shellCommand) {
		return (
			<BashTerminalCard
				command={projection.shellCommand}
				result={block.result}
				status={block.status}
				isError={block.isError}
				startedAt={block.startedAt}
				durationMs={block.durationMs}
				phases={block.phases}
				backgroundTask={backgroundTask}
			/>
		);
	}

	return (
		<>
			{block.mcpApp && !exportMode ? <McpAppSurface attachment={block.mcpApp} input={block.args} /> : null}
			{projection.hasMeta && block.startedAt !== undefined ? (
				<div
					className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/50"
					title={t("toolCall.metaLabel")}
				>
					<span className="font-medium text-muted-foreground/60">{t("toolCall.meta")}</span>
					<span className="tabular-nums">{formatStartedAt(block.startedAt)}</span>
					{block.durationMs !== undefined ? (
						<>
							<span className="text-muted-foreground/30">·</span>
							<span className="tabular-nums">{formatDurationPrecise(block.durationMs)}</span>
						</>
					) : null}
					{block.phases && block.phases.length > 0 && block.durationMs !== undefined ? (
						<>
							<span className="text-muted-foreground/30">·</span>
							<span className="break-all">{formatPhases(block.phases, block.durationMs)}</span>
						</>
					) : null}
				</div>
			) : null}
			<ToolSpecificContent block={block} projection={projection} />
			{projection.audioPreviews.length > 0 ? (
				<div className="mt-2 grid gap-2">
					{projection.audioPreviews.map((audio, index) => (
						<audio
							key={`${audio.mimeType}-${index}`}
							controls
							preload="metadata"
							aria-label={t("toolCall.audioPreview")}
							src={`data:${audio.mimeType};base64,${audio.data}`}
						/>
					))}
				</div>
			) : null}
			{block.isError ? (
				<div className="mt-1 text-[11px] font-medium text-destructive/70">{t("toolCall.error")}</div>
			) : null}
		</>
	);
}

function ToolSpecificContent({
	block,
	projection,
}: {
	block: ToolCallBlock;
	projection: ReturnType<typeof projectToolCallBlock>;
}) {
	if (projection.showImagePreview) {
		return (
			<div className="grid gap-2 sm:grid-cols-2">
				{projection.imagePreviews.map((image, index) => (
					<ReadImageView key={`${image.mimeType}-${index}`} image={image} />
				))}
			</div>
		);
	}
	if (block.toolName === "write") {
		return (
			<>
				<WriteContentView block={block} />
				<ToolErrorResult block={block} />
			</>
		);
	}
	if (block.toolName === "edit") {
		return (
			<>
				<EditDiffView block={block} />
				<ToolErrorResult block={block} />
			</>
		);
	}
	if (block.toolName === "ask_user_question") return <AskUserQuestionView block={block} />;
	if (block.toolName === "kb_filter_by_tags") return <KbFilterByTagsView block={block} />;
	if (block.toolName === "kb_list_available_tags") return <KbListTagsView block={block} />;
	if (block.toolName === "kb_write_page") return <KbWritePageView block={block} />;
	return projection.hasResult ? (
		<pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-muted-foreground/60">
			{block.result}
		</pre>
	) : null;
}

function ToolErrorResult({ block }: { block: ToolCallBlock }) {
	return block.isError && block.result ? (
		<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-destructive/70">
			{block.result}
		</pre>
	) : null;
}

export function ToolCallBlockViewHost({
	block,
	exportMode = false,
	aliased = false,
}: ToolCallBlockProps): JSX.Element {
	const projection = projectToolCallBlock(block, exportMode);
	const label = useToolCallLabel(block, aliased);
	const pluginSlot = useToolCallPluginSlot(block.toolName);
	const backgroundTask = useToolCallBackgroundTask(block.toolCallId, projection.shellCommand);
	const expansion = useToolCallExpansion(exportMode);
	const timing = useToolCallTiming(block);

	if (pluginSlot) {
		return <PluginToolCallContent block={block} mdIntro={projection.mdIntro} pluginSlot={pluginSlot} />;
	}

	return (
		<ToolCall.Root
			canExpand={projection.canExpand}
			expanded={expansion.expanded}
			exportMode={exportMode}
			panelId={expansion.panelId}
			onToggle={expansion.onToggle}
		>
			<ToolCall.Frame>
				<ToolCall.Trigger>
					<ToolCall.StatusIcon
						pending={projection.isPending}
						icon={projection.icon}
						iconColorClass={projection.iconColorClass}
					/>
					{projection.mcpServer ? <ToolCall.Server>{projection.mcpServer}</ToolCall.Server> : null}
					<ToolCall.Name>{label.name}</ToolCall.Name>
					{label.detail ? <ToolCall.Detail title={label.detail}>{label.detail}</ToolCall.Detail> : null}
					{projection.isPending && projection.currentPhase ? (
						<ToolCall.Phase>{projection.currentPhase}</ToolCall.Phase>
					) : null}
					{timing.badgeAvailable && timing.badgeLabel ? (
						<ToolCall.Badge>{timing.badgeLabel}</ToolCall.Badge>
					) : null}
					<ToolCall.Chevron />
				</ToolCall.Trigger>
				<ToolCall.Content>
					<ToolCallContent block={block} exportMode={exportMode} backgroundTask={backgroundTask} />
				</ToolCall.Content>
			</ToolCall.Frame>
		</ToolCall.Root>
	);
}

/** Work 阶段行已经展示过句子，展开时只出结果体、不再套技术头。 */
export function EmbeddedToolCallBlockView({
	block,
	exportMode = false,
}: ToolCallBlockProps): JSX.Element {
	const projection = projectToolCallBlock(block, exportMode);
	const pluginSlot = useToolCallPluginSlot(block.toolName);
	const backgroundTask = useToolCallBackgroundTask(block.toolCallId, projection.shellCommand);

	if (pluginSlot) {
		return <PluginToolCallContent block={block} mdIntro={projection.mdIntro} pluginSlot={pluginSlot} />;
	}
	return (
		<ToolCall.Embedded>
			<ToolCallContent block={block} exportMode={exportMode} backgroundTask={backgroundTask} />
		</ToolCall.Embedded>
	);
}

export { ToolCallBlockViewHost as ToolCallBlockView };
