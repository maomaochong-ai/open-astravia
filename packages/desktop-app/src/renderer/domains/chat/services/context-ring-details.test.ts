import type { ContextCompositionReport } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { buildContextRingDetails, formatTokens } from "./context-ring-details";

describe("context ring details", () => {
	it("maps complete reports to per-section token shares", () => {
		const details = buildContextRingDetails(report(), labels);

		expect(details).toEqual({
			phase: "completed",
			model: "openai/gpt-test",
			actualTokens: "120",
			estimatedTokens: "100",
			coverage: "coverage:complete",
			sections: [
				{
					id: "core",
					title: "system",
					metadata: "owner:core / kind:instruction / base",
					tokens: "40",
					share: "40.0%",
				},
				{
					id: "skill",
					title: "review",
					metadata: "owner:skill / kind:instruction / skills",
					tokens: "60",
					share: "60.0%",
				},
			],
		});
	});

	it("does not calculate a share for partial estimates", () => {
		const partial: ContextCompositionReport = {
			...report(),
			estimate: { tokens: null, knownTokens: 40, coverage: "partial" },
			sections: [
				{ ...report().sections[0] },
				{ ...report().sections[1], estimatedTokens: null, estimateMethod: "unknown" },
			],
		};

		const details = buildContextRingDetails(partial, labels);

		expect(details?.estimatedTokens).toBe("unknown");
		expect(details?.sections.map(({ share }) => share)).toEqual(["unknown", "unknown"]);
	});

	it.each([
		[999, "999"],
		[1_500, "1.5k"],
		[15_000, "15k"],
		[1_500_000, "1.5M"],
	])("formats %i tokens as %s", (tokens, expected) => {
		expect(formatTokens(tokens)).toBe(expected);
	});
});

const labels = {
	unknown: "unknown",
	coverage: { complete: "coverage:complete", partial: "coverage:partial", none: "coverage:none" },
	owner: {
		core: "owner:core",
		skill: "owner:skill",
		plugin: "owner:plugin",
		mcp: "owner:mcp",
		extension: "owner:extension",
		runtime: "owner:runtime",
		user: "owner:user",
		unknown: "owner:unknown",
	},
	kind: {
		instruction: "kind:instruction",
		tool_schema: "kind:tool_schema",
		history: "kind:history",
		runtime_context: "kind:runtime_context",
		user_input: "kind:user_input",
	},
} as const;

function report(): ContextCompositionReport {
	return {
		version: 1,
		callId: "call-1",
		snapshotId: "snapshot-1",
		phase: "completed",
		createdAt: 1,
		model: { provider: "openai", modelId: "gpt-test", contextWindow: 1_000 },
		estimate: { tokens: 100, knownTokens: 100, coverage: "complete" },
		providerReportedInputTokens: 120,
		sections: [
			{
				id: "core",
				kind: "instruction",
				category: "base",
				source: { owner: "core", id: "system" },
				estimatedTokens: 40,
				estimateMethod: "heuristic",
				percentOfWindow: 4,
			},
			{
				id: "skill",
				kind: "instruction",
				category: "skills",
				source: { owner: "skill", id: "review" },
				estimatedTokens: 60,
				estimateMethod: "heuristic",
				percentOfWindow: 6,
			},
		],
	};
}
