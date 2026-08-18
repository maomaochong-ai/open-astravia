import { describe, expect, it } from "vitest";
import { RENDER_CHART_TOOL_DESCRIPTION } from "../src/tool-description";

describe("render_chart description", () => {
	it("requires a material visualization benefit and preserves textual alternatives", () => {
		expect(RENDER_CHART_TOOL_DESCRIPTION).toContain("Use only when");
		expect(RENDER_CHART_TOOL_DESCRIPTION).toContain("materially improves the answer");
		expect(RENDER_CHART_TOOL_DESCRIPTION).toContain("Do NOT use");
		expect(RENDER_CHART_TOOL_DESCRIPTION).toContain("compact table");
	});
});
