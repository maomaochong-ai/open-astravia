import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import type { InlineTokenSupport } from "@vetta-org/theme-ui/markdown";
import { memo } from "react";
import { useRendererMarkdownScope } from "./RendererMarkdownScope";

export interface RendererMarkdownContentProps {
	readonly text: string;
	readonly cwd?: string | null;
	readonly isStreamingTail?: boolean;
	readonly className?: string;
	readonly inlineTokens?: InlineTokenSupport;
}

/** Renderer adapter for the public props-driven markdown view. */
export const RendererMarkdownContent = memo(function RendererMarkdownContent(
	props: RendererMarkdownContentProps,
): JSX.Element {
	const model = useRendererMarkdownScope();
	if (model && props.cwd === undefined) {
		return (
			<MarkdownContent
				{...model}
				text={props.text}
				isStreamingTail={props.isStreamingTail}
				className={props.className}
				inlineTokens={props.inlineTokens}
			/>
		);
	}
	return <ConnectedMarkdownContent {...props} />;
});

function ConnectedMarkdownContent({
	text,
	cwd: cwdOverride,
	isStreamingTail = false,
	className,
	inlineTokens,
}: RendererMarkdownContentProps): JSX.Element {
	const model = useRendererMarkdownModel(cwdOverride);

	return (
		<MarkdownContent
			{...model}
			text={text}
			isStreamingTail={isStreamingTail}
			className={className}
			inlineTokens={inlineTokens}
		/>
	);
}
