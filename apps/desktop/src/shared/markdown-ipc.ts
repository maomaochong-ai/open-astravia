export const MARKDOWN_CHANNELS = {
	openHtml: "markdown:open-html",
	closeHtml: "markdown:close-html",
	renderMermaid: "markdown:render-mermaid",
	favicon: "markdown:favicon",
	imageData: "markdown:image-data",
} as const;

export interface DesktopMarkdownApi {
	openHtml(source: string): Promise<string>;
	closeHtml(id: string): Promise<void>;
	renderMermaid(source: string, theme: "light" | "dark"): Promise<string>;
	favicon(origin: string): Promise<string | null>;
	imageData(url: string): Promise<string>;
}
