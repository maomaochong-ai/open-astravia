import type { ToolCallBlock } from "@shared/store/atoms";
import { ToolCall } from "@vetta/theme-ui/chat";
import { useToolCallBlockModel } from "../../hooks/useToolCallBlockModel";

interface ToolCallBlockProps {
	block: ToolCallBlock;
	exportMode?: boolean;
	/** Work 模式传 true：工具名走 i18n 语义别名。 */
	aliased?: boolean;
}

export function ToolCallBlockViewHost({
	block,
	exportMode = false,
	aliased = false,
}: ToolCallBlockProps): JSX.Element {
	const model = useToolCallBlockModel(block, exportMode, aliased);
	if (model.pluginContent) return <>{model.pluginContent}</>;
	return (
		<ToolCall.Root
			canExpand={model.canExpand}
			expanded={model.expanded}
			exportMode={model.exportMode}
			panelId={model.panelId}
			onToggle={model.onToggle}
		>
			<ToolCall.Frame>
				<ToolCall.Trigger>
					<ToolCall.StatusIcon
						pending={model.isPending}
						icon={model.icon}
						iconColorClass={model.iconColorClass}
					/>
					{model.mcpServer ? <ToolCall.Server>{model.mcpServer}</ToolCall.Server> : null}
					<ToolCall.Name>{model.name}</ToolCall.Name>
					{model.detail ? <ToolCall.Detail title={model.detail}>{model.detail}</ToolCall.Detail> : null}
					{model.isPending && model.currentPhase ? (
						<ToolCall.Phase>{model.currentPhase}</ToolCall.Phase>
					) : null}
					{model.badgeAvailable && model.badgeLabel ? (
						<ToolCall.Badge>{model.badgeLabel}</ToolCall.Badge>
					) : null}
					<ToolCall.Chevron />
				</ToolCall.Trigger>
				<ToolCall.Content>{model.content}</ToolCall.Content>
			</ToolCall.Frame>
		</ToolCall.Root>
	);
}

/** Work 阶段行已经展示过句子，展开时只出结果体、不再套技术头。 */
export function EmbeddedToolCallBlockView({
	block,
	exportMode = false,
	aliased = false,
}: ToolCallBlockProps): JSX.Element {
	const model = useToolCallBlockModel(block, exportMode, aliased);
	if (model.pluginContent) return <>{model.pluginContent}</>;
	return <ToolCall.Embedded>{model.content}</ToolCall.Embedded>;
}

export { ToolCallBlockViewHost as ToolCallBlockView };
