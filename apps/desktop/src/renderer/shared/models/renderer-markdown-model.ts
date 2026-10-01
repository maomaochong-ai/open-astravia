import type { TextBlockViewProps } from "@astravia-org/theme-ui/chat";

export type RendererMarkdownModel = Pick<
	TextBlockViewProps,
	"host" | "theme" | "labels" | "getFileIconClass" | "onOpenFile" | "onOpenUrl"
>;
