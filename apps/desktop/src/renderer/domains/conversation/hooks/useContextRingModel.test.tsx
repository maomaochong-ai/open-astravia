// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { contextUsageAtom } from "@shared/store/atoms";
import type { ContextCompositionReport } from "@astravia/runtime-core";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildContextRingModel, useContextRingScopeModels, useDefaultContextRingModel } from "./useContextRingModel";

const contextRingModelCapture = vi.hoisted(() => ({
	buildDetails: vi.fn(() => null),
	t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: contextRingModelCapture.t }),
}));

vi.mock("../services/context-ring-details", async (importOriginal) => ({
	...(await importOriginal<typeof import("../services/context-ring-details")>()),
	buildContextRingDetails: contextRingModelCapture.buildDetails,
}));

describe("useContextRingModel", () => {
	it("defers detail aggregation until requested and memoizes an unchanged composition", () => {
		const store = createStore();
		const composition: ContextCompositionReport = {
			version: 1,
			callId: "call-1",
			snapshotId: "snapshot-1",
			phase: "prepared",
			createdAt: 1,
			model: { provider: "test", modelId: "test-model", contextWindow: 100_000 },
			estimate: { tokens: 25_000, knownTokens: 25_000, coverage: "complete" },
			sections: [],
		};
		store.set(contextUsageAtom, { percent: 25, contextWindow: 100_000, composition });
		contextRingModelCapture.buildDetails.mockClear();
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

		const { rerender } = renderHook(({ includeDetails }) => useDefaultContextRingModel(includeDetails), {
			initialProps: { includeDetails: false },
			wrapper,
		});

		expect(contextRingModelCapture.buildDetails).not.toHaveBeenCalled();

		act(() => store.set(contextUsageAtom, { percent: 30, contextWindow: 100_000, composition }));
		expect(contextRingModelCapture.buildDetails).not.toHaveBeenCalled();

		rerender({ includeDetails: true });
		expect(contextRingModelCapture.buildDetails).toHaveBeenCalledTimes(1);

		act(() => store.set(contextUsageAtom, { percent: 35, contextWindow: 100_000, composition }));
		expect(contextRingModelCapture.buildDetails).toHaveBeenCalledTimes(1);
	});

	it("uses provider-reported context tokens as the displayed percentage", () => {
		const store = createStore();
		store.set(contextUsageAtom, { percent: 10, contextTokens: 40_000, contextWindow: 100_000 });
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

		const { result } = renderHook(() => useDefaultContextRingModel(false), { wrapper });

		expect(result.current?.percent).toBe(40);
		expect(result.current?.tooltip).toBe("contextRing.tooltip.usage");
	});

	it("builds an independent context model for every team member", () => {
		const firstComposition: ContextCompositionReport = {
			version: 1,
			callId: "call-leader",
			snapshotId: "snapshot-leader",
			phase: "prepared",
			createdAt: 1,
			model: { provider: "test", modelId: "leader-model", contextWindow: 100_000 },
			estimate: { tokens: 20_000, knownTokens: 20_000, coverage: "complete" },
			sections: [],
		};
		const secondComposition: ContextCompositionReport = {
			...firstComposition,
			callId: "call-reviewer",
			snapshotId: "snapshot-reviewer",
			model: { provider: "test", modelId: "reviewer-model", contextWindow: 200_000 },
			estimate: { tokens: 100_000, knownTokens: 100_000, coverage: "complete" },
		};
		const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;

		const { result } = renderHook(
			() =>
				useContextRingScopeModels([
					{
						id: "leader",
						label: "Leader",
						usage: { percent: 20, contextWindow: 100_000, composition: firstComposition },
						isCompacting: false,
					},
					{
						id: "reviewer",
						label: "Reviewer",
						usage: { percent: 50, contextWindow: 200_000, composition: secondComposition },
						isCompacting: true,
					},
				]),
			{ wrapper },
		);

		expect(result.current).toHaveLength(2);
		expect(result.current.map((scope) => scope.id)).toEqual(["leader", "reviewer"]);
		expect(result.current[0]?.model.percent).toBe(20);
		expect(result.current[1]?.model.percent).toBe(50);
		expect(result.current[1]?.model.isCompacting).toBe(true);
	});

	it("turns red only at the real compaction threshold, not at a hardcoded 90%", () => {
		// 1M 窗口、默认设置下压缩线是 max(1000000 - 36000, 80%) = 964000（96.4%）。
		// 943k = 94.3%：写死 90% 的旧规则会在这里就变红，而实际上距压缩还差 2 万 token。
		const belowThreshold = buildContextRingModel(
			{
				usage: { percent: 94.3, contextTokens: 943_000, contextWindow: 1_000_000, compactionThresholdTokens: 964_000 },
				isCompacting: false,
			},
			contextRingModelCapture.t,
			null,
		);
		expect(belowThreshold?.color).toBe("var(--primary)");
		expect(belowThreshold?.tooltip).toBe("contextRing.tooltip.usageWithThreshold");

		const atThreshold = buildContextRingModel(
			{
				usage: { percent: 96.4, contextTokens: 964_000, contextWindow: 1_000_000, compactionThresholdTokens: 964_000 },
				isCompacting: false,
			},
			contextRingModelCapture.t,
			null,
		);
		expect(atThreshold?.color).toBe("var(--destructive)");
	});

	it("falls back to the old 90% rule when the runtime reports no threshold", () => {
		const unknownThreshold = buildContextRingModel(
			{ usage: { percent: 95, contextTokens: 95_000, contextWindow: 100_000 }, isCompacting: false },
			contextRingModelCapture.t,
			null,
		);
		expect(unknownThreshold?.color).toBe("var(--destructive)");
		expect(unknownThreshold?.tooltip).toBe("contextRing.tooltip.usage");
	});
});
