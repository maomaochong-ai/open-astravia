import type { ExportTemplateAssets, ExportTemplateAssetsSource } from "./contracts.js";

export class EmbeddedExportTemplateAssetsSource implements ExportTemplateAssetsSource {
	constructor(private readonly assets: ExportTemplateAssets) {}

	load(): ExportTemplateAssets {
		return this.assets;
	}
}
