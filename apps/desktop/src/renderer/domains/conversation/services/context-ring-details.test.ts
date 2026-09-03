import type { ContextCompositionReport } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import {
	buildContextRingBarSegments,
	buildContextRingDetails,
	type ContextRingDetailGroup,
	type ContextRingDetailGroupKind,
	formatTokens,
} from "./context-ring-details";

describe("context ring details", () => {
	it("groups sections into stable user-facing categories", () => {
		const details = buildContextRingDetails(report(), labels);

		expect(details).toMatchObject({
			phase: "completed",
			model: "openai/gpt-test",
			actualTokens: "120",
			windowLabel: "1.0k",
		});
		expect(details?.groups.map(({ id, tokens, share, itemCount }) => ({ id, tokens, share, itemCount }))).toEqual([
			{ id: "instructions", tokens: "24", share: "20.0%", itemCount: 1 },
			{ id: "capabilities", tokens: "24", share: "20.0%", itemCount: 1 },
			{ id: "tools", tokens: "24", share: "20.0%", itemCount: 1 },
			{ id: "conversation", tokens: "48", share: "40.0%", itemCount: 3 },
		]);
	});

	it("collapses all history messages into one conversation detail", () => {
		const conversation = buildContextRingDetails(report(), labels)?.groups.find(({ id }) => id === "conversation");

		expect(conversation?.sections).toEqual([
			{
				id: "conversation:history",
				title: "kind:history",
				metadata: "",
				tokens: "36",
				share: "30.0%",
				tokenCount: 30,
				itemCount: 2,
				unknownCount: 0,
			},
			{
				id: "conversation:user_input",
				title: "kind:user_input",
				metadata: "",
				tokens: "12",
				share: "10.0%",
				tokenCount: 10,
				itemCount: 1,
				unknownCount: 0,
			},
		]);
	});

	it("keeps known token totals visible when estimate coverage is partial", () => {
		const partial: ContextCompositionReport = {
			...report(),
			// 该用例覆盖没有 Provider 上报时的估算回退路径。
			providerReportedInputTokens: null,
			estimate: { tokens: null, knownTokens: 80, coverage: "partial" },
			sections: report().sections.map((section) =>
				section.id === "tool:read" ? { ...section, estimatedTokens: null, estimateMethod: "unknown" } : section,
			),
		};

		const details = buildContextRingDetails(partial, labels);
		const tools = details?.groups.find(({ id }) => id === "tools");

		expect(tools).toMatchObject({ tokens: "unknown", share: "unknown", unknownCount: 1 });
		expect(details?.groups.find(({ id }) => id === "instructions")).toMatchObject({
			tokens: "20",
			share: "unknown",
		});
	});

	it("normalizes a divergent estimated breakdown as composition that totals 100 percent", () => {
		const divergent: ContextCompositionReport = {
			...report(),
			model: { provider: "openai", modelId: "gpt-test", contextWindow: 128_000 },
			estimate: { tokens: 236_000, knownTokens: 236_000, coverage: "complete" },
			providerReportedInputTokens: 56_000,
			sections: [
				section("instruction:base", "instruction", "core", "base", 5_000),
				section("instruction:extension", "instruction", "extension", "extension", 5_000),
				section("tool:read", "tool_schema", "runtime", "read", 28_000),
				section("message:0", "history", "unknown", "history:0", 198_000),
			],
		};

		const details = buildContextRingDetails(divergent, labels);

		expect(details).toMatchObject({ actualTokens: "56k", windowLabel: "128k" });
		expect(details?.groups.map(({ id, tokens, share }) => ({ id, tokens, share }))).toEqual([
			{ id: "instructions", tokens: "1.2k", share: "2.1%" },
			{ id: "capabilities", tokens: "1.2k", share: "2.1%" },
			{ id: "tools", tokens: "6.6k", share: "11.9%" },
			{ id: "conversation", tokens: "47k", share: "83.9%" },
		]);
	});

	it("normalizes stacked bar segments across the estimated composition", () => {
		const details = buildContextRingDetails(report(), labels);

		const segments = buildContextRingBarSegments(details?.groups ?? [], 0);

		expect(segments).toEqual([
			{ id: "instructions", percent: 20 },
			{ id: "capabilities", percent: 20 },
			{ id: "tools", percent: 20 },
			{ id: "conversation", percent: 40 },
		]);
	});

	it("keeps a clickable minimum width for near-empty segments", () => {
		const segments = buildContextRingBarSegments([group("instructions", 500), group("tools", 1)], 1.5);

		expect(segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeCloseTo(100, 5);
		expect(segments[1]?.percent).toBeGreaterThan(0.1);
	});

	it("scales segments back to the full bar when minimum widths overflow the window", () => {
		const segments = buildContextRingBarSegments([group("instructions", 990), group("tools", 1)], 5);

		expect(segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeCloseTo(100, 5);
		expect(segments[1]?.percent).toBeGreaterThan(0);
	});

	it("splits the bar evenly when no known tokens are available", () => {
		const segments = buildContextRingBarSegments([group("instructions", 0), group("tools", 0)]);

		expect(segments).toEqual([
			{ id: "instructions", percent: 50 },
			{ id: "tools", percent: 50 },
		]);
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
	group: {
		instructions: "group:instructions",
		capabilities: "group:capabilities",
		tools: "group:tools",
		conversation: "group:conversation",
		runtime: "group:runtime",
	},
} as const;

function group(id: ContextRingDetailGroupKind, tokenCount: number): ContextRingDetailGroup {
	return {
		id,
		title: id,
		tokens: String(tokenCount),
		share: "",
		tokenCount,
		itemCount: 1,
		unknownCount: 0,
		sections: [],
	};
}

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
			section("instruction:base", "instruction", "core", "base", 20),
			section("instruction:review", "instruction", "extension", "review", 20),
			section("tool:read", "tool_schema", "runtime", "read", 20),
			section("message:0", "history", "unknown", "history:0", 10),
			section("message:1", "history", "unknown", "history:1", 20),
			section("message:2", "user_input", "user", "current-input", 10),
		],
	};
}

function section(
	id: string,
	kind: ContextCompositionReport["sections"][number]["kind"],
	owner: ContextCompositionReport["sections"][number]["source"]["owner"],
	sourceId: string,
	estimatedTokens: number,
): ContextCompositionReport["sections"][number] {
	return {
		id,
		kind,
		category: kind,
		source: { owner, id: sourceId },
		estimatedTokens,
		estimateMethod: "heuristic",
		percentOfWindow: estimatedTokens / 10,
	};
}
