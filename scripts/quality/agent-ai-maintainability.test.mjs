import { describe, expect, it } from "vitest";
import { findAgentAiMaintainabilityViolations } from "./check-agent-ai-maintainability.mjs";

describe("Agent and AI import type convention", () => {
	it("accepts top-level import types", () => {
		expect(
			findAgentAiMaintainabilityViolations([
				{
					path: "packages/agent/src/example.ts",
					text: 'import type { Stats } from "./stats.js";\nlet value: Stats;',
				},
			]),
		).toEqual([]);
	});

	it("rejects inline import types", () => {
		expect(
			findAgentAiMaintainabilityViolations([
				{ path: "packages/ai/src/example.ts", text: 'let value: typeof import("node:fs");' },
			]),
		).toEqual(["packages/ai/src/example.ts: inline import type is forbidden; use a top-level import type"]);
	});
});
