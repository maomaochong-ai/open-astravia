import { existsSync, writeFileSync } from "node:fs";
import { getExportTemplateDir } from "../config.js";
import { readCodingAgentLegacySessionDocument } from "../sessions/legacy/document.js";
import type {
	CodingAgentHtmlExportRuntime,
	ExportTemplateAssets,
	ExportTemplateAssetsSource,
	HtmlExportFileWriter,
	HtmlExportThemeSource,
	LegacySessionExportReader,
} from "./contracts.js";
import { DefaultCodingAgentHtmlExportRuntime } from "./export-runtime.js";
import { HtmlDocumentRenderer } from "./html-renderer.js";
import { EmbeddedExportTemplateAssetsSource, FileExportTemplateAssetsSource } from "./template-assets.js";
import { CodingAgentHtmlExportThemeSource } from "./theme-source.js";

export interface CreateCodingAgentHtmlExportRuntimeOptions {
	readonly assets?: ExportTemplateAssets;
	readonly assetsSource?: ExportTemplateAssetsSource;
	readonly themes?: HtmlExportThemeSource;
	readonly writer?: HtmlExportFileWriter;
	readonly legacySessions?: LegacySessionExportReader;
}

export function createCodingAgentHtmlExportRuntime(
	options: CreateCodingAgentHtmlExportRuntimeOptions = {},
): CodingAgentHtmlExportRuntime {
	if (options.assets && options.assetsSource) {
		throw new Error("HTML export assets and assetsSource are mutually exclusive");
	}
	const assets =
		options.assetsSource ??
		(options.assets
			? new EmbeddedExportTemplateAssetsSource(options.assets)
			: new FileExportTemplateAssetsSource(getExportTemplateDir()));
	return new DefaultCodingAgentHtmlExportRuntime({
		renderer: new HtmlDocumentRenderer({
			assets,
			themes: options.themes ?? new CodingAgentHtmlExportThemeSource(),
		}),
		writer: options.writer ?? DEFAULT_FILE_WRITER,
		legacySessions: options.legacySessions ?? DEFAULT_LEGACY_SESSION_READER,
	});
}

const DEFAULT_FILE_WRITER: HtmlExportFileWriter = {
	write: (outputPath, html) => writeFileSync(outputPath, html, "utf8"),
};

const DEFAULT_LEGACY_SESSION_READER: LegacySessionExportReader = {
	exists: existsSync,
	read: readCodingAgentLegacySessionDocument,
};
