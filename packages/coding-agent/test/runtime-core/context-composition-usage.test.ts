import type { ContextCompositionReport } from "@astravia/runtime-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS } from "../../src/compaction/contracts.js";
import { DefaultCodingAgentContextRuntime } from "../../src/compaction/runtime/context-runtime.js";
import type { CodingAgentContextRuntime } from "../../src/runtime-contracts/index.js";

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
			// 默认设置：max(1000 - 36000, 1000 × 80%) = 800。
			thresholdTokens: 800,
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

	it("reports the automatic compaction trigger line alongside usage", () => {
		// 环形的「变红」要与压缩决策同源：默认设置下 1M 窗口的触发线是 964000（96.4%），
		// 而不是 90%。宿主把这个数透传给 UI，才能在它之前保持常态、之后才报警。
		const runtime = createRuntime();
		expect(runtime.readUsage(1_000_000).thresholdTokens).toBe(964_000);
		runtime.dispose();
	});

	it("follows the configured compaction policy instead of a fixed percentage", () => {
		const runtime = new DefaultCodingAgentContextRuntime({
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
			resolveSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, reserveTokens: 1_000, minFreePercent: 10 }),
		});

		expect(runtime.readUsage(100_000).thresholdTokens).toBe(99_000);
		runtime.dispose();
	});
});

function createRuntime(): CodingAgentContextRuntime {
	return new DefaultCodingAgentContextRuntime({
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
