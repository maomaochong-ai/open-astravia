import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productionSources = {
	composition: readSource("./composition.ts"),
	hostServices: readSource("./host-services.ts"),
	knowledgeFactory: readSource("../knowledge/processing-session-factory.ts"),
	historicalImportBackend: readSource(
		"../../../../../packages/runtime-desktop/src/historical-session-import-backend.ts",
	),
	historicalSessionFormat: readSource("../../../../../packages/runtime-desktop/src/historical-session-format.ts"),
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

	// 工作模式注册表归 desktop 所有（ADR-0071 修订）：coding-agent 只保留 core.mode 槽位，
	// 正文必须由生产 composition 注入。漏接这一行不会有类型错误，模式提示词会静默消失，
	// 所以在装配源码层面钉死。
	it("injects the Desktop-owned mode prompt resolver into the production composition", () => {
		expect(productionSources.composition).toContain("resolveModePrompt: getModePrompt");
		expect(productionSources.composition).toContain('from "../agent-modes/index.js"');
	});

	it("keeps the Runtime entry limited to singleton lifecycle ownership", () => {
		expect(productionSources.runtimeEntry).toContain("DesktopRuntimeController");
		expect(productionSources.runtimeEntry).not.toContain("CatalogRoutedRuntimeHostSessionBackend");
		expect(productionSources.runtimeEntry).not.toContain("DesktopRuntimeSessionCatalog");
	});
});

function readSource(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
