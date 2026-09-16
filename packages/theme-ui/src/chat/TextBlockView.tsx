/** Compatibility export for published chat consumers; implementation lives in ./markdown. */
export { MarkdownContent as TextBlockView } from "../markdown/MarkdownContent";
export type {
	MarkdownContentProps as TextBlockViewProps,
	MarkdownLabels as TextBlockViewLabels,
} from "../markdown/MarkdownContent";
export type { InlineTokenSupport, InlineTokenPiece, InlineTokenAnnotation } from "../markdown/inline-tokens";
