import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExportTemplateAssets, ExportTemplateAssetsSource } from "./contracts.js";

export class FileExportTemplateAssetsSource implements ExportTemplateAssetsSource {
	constructor(private readonly directory: string) {}

	load(): ExportTemplateAssets {
		return {
			template: readFileSync(join(this.directory, "template.html"), "utf-8"),
			css: readFileSync(join(this.directory, "template.css"), "utf-8"),
			js: readFileSync(join(this.directory, "template.js"), "utf-8"),
			markedJs: readFileSync(join(this.directory, "vendor", "marked.min.js"), "utf-8"),
			highlightJs: readFileSync(join(this.directory, "vendor", "highlight.min.js"), "utf-8"),
		};
	}
}

export class EmbeddedExportTemplateAssetsSource implements ExportTemplateAssetsSource {
	constructor(private readonly assets: ExportTemplateAssets) {}

	load(): ExportTemplateAssets {
		return this.assets;
	}
}
