import { parseInputSegments } from "@shared/lib/input-tokens";
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
	 * 图片编号由调用方给（同一条消息里缩略图与胶囊必须同号）。
	 */
	inlineTokens?: { getImageLabel: (path: string) => string };
}

/** 语法住在 shared/lib/input-tokens，theme-ui 只认结构，因此解析器由宿主注入。 */
const parseTokens = (text: string): InlineTokenPiece[] => parseInputSegments(text).segments;

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
		() => (inlineTokens ? { parse: parseTokens, getImageLabel: inlineTokens.getImageLabel } : undefined),
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
