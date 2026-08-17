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
			tokens: "120",
		});
		expect(details?.groups.map(({ id, tokens, share, itemCount }) => ({ id, tokens, share, itemCount }))).toEqual([
			{ id: "instructions", tokens: "20", share: "20.0%", itemCount: 1 },
			{ id: "capabilities", tokens: "20", share: "20.0%", itemCount: 1 },
			{ id: "tools", tokens: "20", share: "20.0%", itemCount: 1 },
			{ id: "conversation", tokens: "40", share: "40.0%", itemCount: 3 },
		]);
	});

	it("collapses all history messages into one conversation detail", () => {
		const conversation = buildContextRingDetails(report(), labels)?.groups.find(({ id }) => id === "conversation");

		expect(conversation?.sections).toEqual([
			{
				id: "conversation:history",
				title: "kind:history",
				metadata: "",
				tokens: "30",
				share: "30.0%",
				tokenCount: 30,
				itemCount: 2,
				unknownCount: 0,
			},
			{
				id: "conversation:user_input",
				title: "kind:user_input",
				metadata: "",
				tokens: "10",
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

		expect(details?.tokens).toBe("80");
		expect(tools).toMatchObject({ tokens: "unknown", share: "unknown", unknownCount: 1 });
		expect(details?.groups.find(({ id }) => id === "instructions")?.tokens).toBe("20");
	});

	it("measures stacked bar segments against the model context window", () => {
		const details = buildContextRingDetails(report(), labels);

		const segments = buildContextRingBarSegments(details?.groups ?? [], details?.windowTokens ?? null, 0);

		// 窗口 1000，已用 100，因此各段合计只占条的 10%，其余留白。
		expect(details?.windowTokens).toBe(1_000);
		expect(segments).toEqual([
			{ id: "instructions", percent: 2 },
			{ id: "capabilities", percent: 2 },
			{ id: "tools", percent: 2 },
			{ id: "conversation", percent: 4 },
		]);
	});

	it("keeps a clickable minimum width for near-empty segments", () => {
		const segments = buildContextRingBarSegments([group("instructions", 500), group("tools", 1)], 1_000, 1.5);

		expect(segments).toEqual([
			{ id: "instructions", percent: 50 },
			{ id: "tools", percent: 1.5 },
		]);
	});

	it("scales segments back to the full bar when minimum widths overflow the window", () => {
		const segments = buildContextRingBarSegments([group("instructions", 990), group("tools", 1)], 1_000, 5);

		expect(segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeCloseTo(100, 5);
		expect(segments[1]?.percent).toBeGreaterThan(0);
	});

	it("falls back to normalizing across groups when the window is unknown", () => {
		const segments = buildContextRingBarSegments([group("instructions", 30), group("tools", 10)], null, 0);

		expect(segments).toEqual([
			{ id: "instructions", percent: 75 },
			{ id: "tools", percent: 25 },
		]);
	});

	it("splits the bar evenly when neither window nor known tokens are available", () => {
		const segments = buildContextRingBarSegments([group("instructions", 0), group("tools", 0)], null);

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
			section("instruction:review", "instruction", "skill", "review", 20),
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
