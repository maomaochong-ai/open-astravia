import { getExportTemplateDir } from "@astravia/coding-agent/config";
import { createCodingAgentHtmlExportRuntime } from "@astravia/coding-agent/export-html";
import { parseCodingAgentHistoricalSessionDocument } from "@astravia/coding-agent/historical-sessions";
import { createNodeHtmlExportFileAdapters, nodeSyncTextFileSource } from "@astravia/runtime-node/host";

export function createCliCodingAgentHtmlExportRuntime() {
	return createCodingAgentHtmlExportRuntime(
		createNodeHtmlExportFileAdapters({
			templateDirectory: getExportTemplateDir(),
			readLegacySession: (path) => parseCodingAgentHistoricalSessionDocument(nodeSyncTextFileSource.read(path)),
		}),
	);
}
