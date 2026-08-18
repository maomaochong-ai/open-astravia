import { getExportTemplateDir } from "@vetta/coding-agent/config";
import { createCodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import { parseCodingAgentHistoricalSessionDocument } from "@vetta/coding-agent/historical-sessions";
import { createNodeHtmlExportFileAdapters, nodeSyncTextFileSource } from "@vetta/runtime-node/host";

export function createCliCodingAgentHtmlExportRuntime() {
	return createCodingAgentHtmlExportRuntime(
		createNodeHtmlExportFileAdapters({
			templateDirectory: getExportTemplateDir(),
			readLegacySession: (path) => parseCodingAgentHistoricalSessionDocument(nodeSyncTextFileSource.read(path)),
		}),
	);
}
