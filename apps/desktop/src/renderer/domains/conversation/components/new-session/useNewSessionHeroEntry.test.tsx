// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNewSessionHeroEntry } from "./useNewSessionHeroEntry";

afterEach(() => vi.useRealTimers());

describe("new-session Hero entry", () => {
	it("reveals the greeting after StrictMode replays its effect", () => {
		vi.useFakeTimers();
		const { result, rerender } = renderHook(
			({ cwd }: { cwd: string }) => useNewSessionHeroEntry(cwd),
			{
				initialProps: { cwd: "C:/first" },
				wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
			},
		);

		expect(result.current.mounted).toBe(false);
		act(() => vi.advanceTimersByTime(30));
		expect(result.current.mounted).toBe(true);
		act(() => vi.advanceTimersByTime(270));
		expect(result.current.avatarAutoplay).toBe(true);

		rerender({ cwd: "C:/second" });
		expect(result.current.mounted).toBe(false);
		act(() => vi.advanceTimersByTime(30));
		expect(result.current.mounted).toBe(true);
	});
});
