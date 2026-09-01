import type { TextBlockViewProps } from "@vetta/theme-ui/chat";

export type RendererMarkdownModel = Pick<
	TextBlockViewProps,
	"theme" | "labels" | "getFileIconClass" | "onOpenFile" | "onOpenUrl"
>;
