import type { TextBlockViewProps } from "@vetta-org/theme-ui/chat";

export type RendererMarkdownModel = Pick<
	TextBlockViewProps,
	"theme" | "labels" | "getFileIconClass" | "onOpenFile" | "onOpenUrl"
>;
