import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productionSources = {
	composition: readSource("./composition.ts"),
	hostServices: readSource("./host-services.ts"),
	knowledgeFactory: readSource("../knowledge/processing-session-factory.ts"),
	historicalImportBackend: readSource("./historical-session-import-backend.ts"),
	historicalSessionFormat: readSource("./historical-session-format.ts"),
	poller: readSource("../knowledge/poller.ts"),
	runtimeEntry: readSource("../runtime.ts"),
};

describe("Desktop Runtime composition boundary", () => {
	it("keeps deprecated coding-agent subpaths out of the production composition", () => {
		for (const [name, source] of Object.entries(productionSources)) {
			expect(source, name).not.toContain("@vetta/coding-agent/legacy/");
			expect(source, name).not.toContain("@vetta/coding-agent/runtime-host");
		}
	});

	it("keeps Legacy format migration without a production execution backend", () => {
		expect(productionSources.historicalSessionFormat).not.toContain("LegacyCodingAgentSessionBackend");
		expect(productionSources.historicalSessionFormat).toContain("createCodingAgentHistoricalSessionCatalog");
		expect(productionSources.historicalSessionFormat).toContain(
			"createCodingAgentHistoricalSessionFileHistoryReader",
		);
		expect(productionSources.historicalSessionFormat).not.toContain("LegacyRuntimeSessionCatalog");
		expect(productionSources.historicalSessionFormat).not.toContain("LegacyRuntimeSessionFileHistoryReader");
		expect(productionSources.composition).not.toContain("LegacyCodingAgentSessionBackend");
		expect(productionSources.composition).not.toContain("createDesktopLegacyExecutionCompatibility");
		expect(productionSources.composition).toContain("DesktopHistoricalSessionImportBackend");
		expect(productionSources.composition).toContain("createDesktopHistoricalSessionFormat");
		expect(productionSources.composition).toContain("createCodingAgentSharedModelController");
		expect(productionSources.historicalImportBackend).not.toContain("LegacyCodingAgentSessionBackend");
		expect(productionSources.historicalImportBackend).toContain("migrateCodingAgentHistoricalSession");
		expect(productionSources.knowledgeFactory).not.toContain("createLegacyKnowledgeProcessingSessionFactory");
	});

	it("keeps the Runtime entry limited to singleton lifecycle ownership", () => {
		expect(productionSources.runtimeEntry).toContain("createDesktopRuntimeComposition");
		expect(productionSources.runtimeEntry).not.toContain("CatalogRoutedRuntimeHostSessionBackend");
		expect(productionSources.runtimeEntry).not.toContain("DesktopRuntimeSessionCatalog");
	});
});

function readSource(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
