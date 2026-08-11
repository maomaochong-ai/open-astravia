import type { ConversationDocument } from "@vetta/runtime-core";

export interface ExportedToolInfo {
	readonly name: string;
	readonly description: string;
	readonly parameters: unknown;
}

export interface RenderableToolResultPart {
	readonly type: string;
	readonly text?: string;
	readonly data?: string;
	readonly mimeType?: string;
}

export interface ToolHtmlRenderer {
	renderCall(toolName: string, args: unknown): string | undefined;
	renderResult(
		toolName: string,
		result: readonly RenderableToolResultPart[],
		details: unknown,
		isError: boolean,
	): string | undefined;
}

export interface HtmlExportOptions {
	readonly outputPath?: string;
	readonly themeName?: string;
	readonly toolRenderer?: ToolHtmlRenderer;
	readonly systemPrompt?: string;
	readonly tools?: readonly ExportedToolInfo[];
}

export interface ExportTemplateAssets {
	readonly template: string;
	readonly css: string;
	readonly js: string;
	readonly markedJs: string;
	readonly highlightJs: string;
}

export interface ExportTemplateAssetsSource {
	load(): ExportTemplateAssets;
}

export interface HtmlExportTheme {
	readonly colors: Readonly<Record<string, string>>;
	readonly pageBg?: string;
	readonly cardBg?: string;
	readonly infoBg?: string;
}

export interface HtmlExportThemeSource {
	resolve(themeName?: string): HtmlExportTheme;
}

export interface HtmlExportFileWriter {
	write(outputPath: string, html: string): void;
}

export interface LegacySessionExportDocument {
	readonly header: unknown;
	readonly entries: readonly unknown[];
	readonly activeLeafId: string | null;
}

export interface LegacySessionExportReader {
	exists(inputPath: string): boolean;
	read(inputPath: string): LegacySessionExportDocument;
}

export interface CodingAgentHtmlExportRuntime {
	exportLegacySession(inputPath: string, options?: HtmlExportOptions | string): Promise<string>;
	exportConversation(
		document: ConversationDocument,
		sessionFile: string,
		options?: HtmlExportOptions | string,
	): Promise<string>;
}
