// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { atom, getDefaultStore } from "jotai";
import { describe, expect, it } from "vitest";
import { usePausedAtomValue } from "./usePausedAtomValue";

describe("usePausedAtomValue", () => {
	it("未暂停时跟随 atom 更新，暂停后冻结，恢复后追上最新值", () => {
		const countAtom = atom(0);
		const { result, rerender } = renderHook(({ paused }: { paused: boolean }) => usePausedAtomValue(countAtom, paused), {
			initialProps: { paused: false },
		});
		expect(result.current).toBe(0);

		act(() => {
			getDefaultStore().set(countAtom, 1);
		});
		expect(result.current).toBe(1);

		rerender({ paused: true });
		act(() => {
			getDefaultStore().set(countAtom, 2);
		});
		expect(result.current).toBe(1);

		rerender({ paused: false });
		expect(result.current).toBe(2);
	});
});
