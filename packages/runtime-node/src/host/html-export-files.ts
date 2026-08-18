import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface NodeHtmlExportFileAdaptersOptions<TLegacyDocument> {
	readonly templateDirectory: string;
	readonly readLegacySession: (path: string) => TLegacyDocument;
}

/** Node file adapters for the structurally typed Coding Agent HTML export ports. */
export function createNodeHtmlExportFileAdapters<TLegacyDocument>(
	options: NodeHtmlExportFileAdaptersOptions<TLegacyDocument>,
) {
	return {
		assetsSource: {
			load: () => ({
				template: readFileSync(join(options.templateDirectory, "template.html"), "utf8"),
				css: readFileSync(join(options.templateDirectory, "template.css"), "utf8"),
				js: readFileSync(join(options.templateDirectory, "template.js"), "utf8"),
				markedJs: readFileSync(join(options.templateDirectory, "vendor", "marked.min.js"), "utf8"),
				highlightJs: readFileSync(join(options.templateDirectory, "vendor", "highlight.min.js"), "utf8"),
			}),
		},
		writer: {
			write: (outputPath: string, html: string) => writeFileSync(outputPath, html, "utf8"),
		},
		legacySessions: {
			exists: existsSync,
			read: options.readLegacySession,
		},
	};
}
