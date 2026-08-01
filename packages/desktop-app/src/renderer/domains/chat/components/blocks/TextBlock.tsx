import { parseInputSegments } from "@shared/lib/input-tokens";
import {
	getBuiltinMcpPresetByName,
	resolveMcpPresetIconUrl,
} from "@domains/settings/mcp/builtin-mcp-presets";
import {
	type InlineTokenPiece,
	type InlineTokenSupport,
	TextBlockView as ThemeTextBlockView,
} from "@vetta/theme-ui/chat";
import { memo, useMemo } from "react";
import { useTextBlockModel } from "../../hooks/useTextBlockModel";

interface MarkdownContentProps {
	text: string;
	/** 仅当本 block 是「正在 streaming 消息」的最后一个 text block 时为 true，
	 * 启用分块渐现效果。 */
	isStreamingTail?: boolean;
	className?: string;
	/**
	 * 用户消息传入：把 `@skill:名字` / `@绝对路径` 渲染成行内胶囊。
	 * 图片编号由调用方给（同一条消息里缩略图与胶囊必须同号）；
	 * skill 的别名与图标同理，只有宿主查得到。
	 */
	inlineTokens?: {
		getImageLabel: (path: string) => string;
		getSkill?: (name: string) => { label: string; icon?: string } | undefined;
	};
}

/** 语法住在 shared/lib/input-tokens，theme-ui 只认结构，因此解析器由宿主注入。 */
const parseTokens = (text: string): InlineTokenPiece[] => parseInputSegments(text).segments;

/** 连接器的展示名与 logo 来自内置预设表；查不到（已删除的条目）就用真实名兜底。 */
function lookupConnector(name: string): { label: string; iconUrl?: string } | undefined {
	const preset = getBuiltinMcpPresetByName(name);
	if (!preset) return undefined;
	const iconUrl = resolveMcpPresetIconUrl(preset);
	return { label: preset.name, ...(iconUrl ? { iconUrl } : {}) };
}

/**
 * Memo'd markdown renderer. Re-rendering is throttled upstream by rAF
 * delta batching in useSessionManager (~16fps), so we render directly
 * without internal debounce to avoid layout jumps during streaming.
 */
export const MarkdownContent = memo(function MarkdownContent({
	text,
	isStreamingTail = false,
	className,
	inlineTokens,
}: MarkdownContentProps) {
	const model = useTextBlockModel();
	// 引用要稳定：rehype 插件数组一换，ReactMarkdown 就整树重建。
	const inlineTokenSupport = useMemo<InlineTokenSupport | undefined>(
		() =>
			inlineTokens
				? {
						parse: parseTokens,
						getImageLabel: inlineTokens.getImageLabel,
						getConnector: lookupConnector,
						...(inlineTokens.getSkill ? { getSkill: inlineTokens.getSkill } : {}),
					}
				: undefined,
		[inlineTokens],
	);
	return (
		<ThemeTextBlockView
			text={text}
			isStreamingTail={isStreamingTail}
			className={className}
			{...(inlineTokenSupport ? { inlineTokens: inlineTokenSupport } : {})}
			{...model}
		/>
	);
});

export const TextBlockView = MarkdownContent;
