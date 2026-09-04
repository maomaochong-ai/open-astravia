// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { contextUsageAtom } from "@shared/store/atoms";
import type { ContextCompositionReport } from "@vetta/runtime-core";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useContextRingScopeModels, useDefaultContextRingModel } from "./useContextRingModel";

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
});
