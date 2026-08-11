import type { ContextCompositionReport } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { CodingAgentContextRuntime } from "../../src/adapters/runtime-core/context-runtime/context-runtime.js";

describe("CodingAgentContextRuntime context composition", () => {
	it("stores prepared reports and applies completed provider input usage", () => {
		const runtime = createRuntime();
		const prepared = report("prepared");

		runtime.publishContextComposition(prepared);
		expect(runtime.readUsage(1_000)).toMatchObject({
			tokens: 0,
			composition: prepared,
		});

		const completed = { ...prepared, phase: "completed" as const, providerReportedInputTokens: 125 };
		runtime.publishContextComposition(completed);
		expect(runtime.readUsage(1_000)).toEqual({
			tokens: 125,
			contextWindow: 1_000,
			percent: 12.5,
			composition: completed,
		});
		runtime.dispose();
	});

	it("does not replace known usage when a provider omits input tokens", () => {
		const runtime = createRuntime();
		runtime.publishContextComposition({
			...report("completed"),
			providerReportedInputTokens: null,
		});

		expect(runtime.readUsage(1_000).tokens).toBe(0);
		runtime.dispose();
	});
});

function createRuntime(): CodingAgentContextRuntime {
	return new CodingAgentContextRuntime({
		hookRuntime: {
			markSessionStart() {},
			async runPreCompact() {
				return emptyHookOutcome();
			},
			async runPostCompact() {
				return emptyHookOutcome();
			},
		},
		resolveApiKey: () => "test-key",
	});
}

function emptyHookOutcome() {
	return {
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		continuationFragments: [],
		runs: [],
	};
}

function report(phase: ContextCompositionReport["phase"]): ContextCompositionReport {
	return {
		version: 1,
		callId: "call-1",
		snapshotId: "snapshot-1",
		phase,
		createdAt: 1,
		model: { provider: "test", modelId: "model", contextWindow: 1_000 },
		estimate: { tokens: 100, knownTokens: 100, coverage: "complete" },
		sections: [],
	};
}
