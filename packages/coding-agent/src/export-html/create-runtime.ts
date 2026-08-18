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
import { EmbeddedExportTemplateAssetsSource } from "./template-assets.js";
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
		(options.assets ? new EmbeddedExportTemplateAssetsSource(options.assets) : UNAVAILABLE_ASSETS_SOURCE);
	return new DefaultCodingAgentHtmlExportRuntime({
		renderer: new HtmlDocumentRenderer({
			assets,
			themes: options.themes ?? new CodingAgentHtmlExportThemeSource(),
		}),
		writer: options.writer ?? UNAVAILABLE_FILE_WRITER,
		legacySessions: options.legacySessions ?? UNAVAILABLE_LEGACY_SESSION_READER,
	});
}

const UNAVAILABLE_ASSETS_SOURCE: ExportTemplateAssetsSource = {
	load() {
		throw new Error("HTML export template assets were not configured by the host");
	},
};

const UNAVAILABLE_FILE_WRITER: HtmlExportFileWriter = {
	write() {
		throw new Error("HTML export file writer was not configured by the host");
	},
};

const UNAVAILABLE_LEGACY_SESSION_READER: LegacySessionExportReader = {
	exists: () => false,
	read() {
		throw new Error("Legacy session reader was not configured by the host");
	},
};
