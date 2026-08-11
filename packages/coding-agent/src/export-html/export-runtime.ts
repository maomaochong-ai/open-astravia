import { basename } from "node:path";
import type { ConversationDocument } from "@vetta/runtime-core";
import { APP_NAME } from "../config.js";
import type {
	CodingAgentHtmlExportRuntime,
	HtmlExportFileWriter,
	HtmlExportOptions,
	LegacySessionExportReader,
} from "./contracts.js";
import { projectConversationHtmlExportDocument, projectLegacyHtmlExportDocument } from "./export-document.js";
import type { HtmlDocumentRenderer } from "./html-renderer.js";

export interface DefaultCodingAgentHtmlExportRuntimeOptions {
	readonly renderer: HtmlDocumentRenderer;
	readonly writer: HtmlExportFileWriter;
	readonly legacySessions: LegacySessionExportReader;
}

export class DefaultCodingAgentHtmlExportRuntime implements CodingAgentHtmlExportRuntime {
	constructor(private readonly options: DefaultCodingAgentHtmlExportRuntimeOptions) {}

	async exportLegacySession(inputPath: string, options?: HtmlExportOptions | string): Promise<string> {
		if (!this.options.legacySessions.exists(inputPath)) throw new Error(`File not found: ${inputPath}`);
		const resolved = resolveOptions(options);
		const document = projectLegacyHtmlExportDocument(this.options.legacySessions.read(inputPath));
		const outputPath = resolved.outputPath ?? `${APP_NAME}-session-${basename(inputPath, ".jsonl")}.html`;
		this.options.writer.write(outputPath, this.options.renderer.render(document, resolved.themeName));
		return outputPath;
	}

	async exportConversation(
		document: ConversationDocument,
		sessionFile: string,
		options?: HtmlExportOptions | string,
	): Promise<string> {
		const resolved = resolveOptions(options);
		const exportDocument = projectConversationHtmlExportDocument(document, resolved);
		const outputPath =
			resolved.outputPath ?? `${APP_NAME}-session-${basename(sessionFile, ".conversation.jsonl")}.html`;
		this.options.writer.write(outputPath, this.options.renderer.render(exportDocument, resolved.themeName));
		return outputPath;
	}
}

function resolveOptions(options: HtmlExportOptions | string | undefined): HtmlExportOptions {
	return typeof options === "string" ? { outputPath: options } : (options ?? {});
}
