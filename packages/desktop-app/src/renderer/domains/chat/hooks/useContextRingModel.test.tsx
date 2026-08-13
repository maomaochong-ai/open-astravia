// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { contextUsageAtom } from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useContextRingModel } from "./useContextRingModel";

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
		const composition = { callId: "call-1" } as never;
		store.set(contextUsageAtom, { percent: 25, contextWindow: 100_000, composition });
		contextRingModelCapture.buildDetails.mockClear();
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

		const { rerender } = renderHook(({ includeDetails }) => useContextRingModel(includeDetails), {
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
});
