import type { ContextCompositionReport } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { buildContextRingDetails, formatTokens, toggleExpandedContextGroup } from "./context-ring-details";

describe("context ring details", () => {
	it("groups sections into stable user-facing categories", () => {
		const details = buildContextRingDetails(report(), labels);

		expect(details).toMatchObject({
			phase: "completed",
			model: "openai/gpt-test",
			actualTokens: "120",
			estimatedTokens: "100",
			coverage: "coverage:complete",
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
				itemCount: 2,
				unknownCount: 0,
			},
			{
				id: "conversation:user_input",
				title: "kind:user_input",
				metadata: "",
				tokens: "10",
				share: "10.0%",
				itemCount: 1,
				unknownCount: 0,
			},
		]);
	});

	it("keeps known token totals visible when estimate coverage is partial", () => {
		const partial: ContextCompositionReport = {
			...report(),
			estimate: { tokens: null, knownTokens: 80, coverage: "partial" },
			sections: report().sections.map((section) =>
				section.id === "tool:read" ? { ...section, estimatedTokens: null, estimateMethod: "unknown" } : section,
			),
		};

		const details = buildContextRingDetails(partial, labels);
		const tools = details?.groups.find(({ id }) => id === "tools");

		expect(details?.estimatedTokens).toBe("80+");
		expect(tools).toMatchObject({ tokens: "unknown", share: "unknown", unknownCount: 1 });
		expect(details?.groups.find(({ id }) => id === "instructions")?.tokens).toBe("20");
	});

	it("expands one group at a time and collapses the selected group", () => {
		expect(toggleExpandedContextGroup(null, "tools")).toBe("tools");
		expect(toggleExpandedContextGroup("tools", "conversation")).toBe("conversation");
		expect(toggleExpandedContextGroup("conversation", "conversation")).toBeNull();
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
	group: {
		instructions: "group:instructions",
		capabilities: "group:capabilities",
		tools: "group:tools",
		conversation: "group:conversation",
		runtime: "group:runtime",
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
