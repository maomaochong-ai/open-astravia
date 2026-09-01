import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import { TextBlockView, type InlineTokenSupport } from "@vetta/theme-ui/chat";
import { memo } from "react";

export interface RendererMarkdownContentProps {
	readonly text: string;
	readonly cwd?: string | null;
	readonly isStreamingTail?: boolean;
	readonly className?: string;
	readonly inlineTokens?: InlineTokenSupport;
}

/** Renderer adapter for the public props-driven markdown view. */
export const RendererMarkdownContent = memo(function RendererMarkdownContent({
	text,
	cwd: cwdOverride,
	isStreamingTail = false,
	className,
	inlineTokens,
}: RendererMarkdownContentProps): JSX.Element {
	const model = useRendererMarkdownModel(cwdOverride);

	return (
		<TextBlockView
			{...model}
			text={text}
			isStreamingTail={isStreamingTail}
			className={className}
			inlineTokens={inlineTokens}
		/>
	);
});
