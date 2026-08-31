// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	DesktopSessionSearchEvent,
	DesktopSessionSearchRequest,
	DesktopSessionSearchResult,
} from "@/shared/session-search";
import { useSessionSearch } from "./useSessionSearch";

const result: DesktopSessionSearchResult = {
	session: {
		id: "one",
		path: "one",
		cwd: "cwd",
		firstMessage: "hello",
		modifiedAt: 1,
		access: { readHistory: true, resume: true, rename: true, delete: true },
	},
	sourceCwd: "cwd",
	sourceKind: "project",
	match: { field: "userMessage", snippet: "hello" },
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("useSessionSearch", () => {
	it("debounces input, streams immediately, restarts filters, and rejects stale events after close/unmount", async () => {
		vi.useFakeTimers();
		const calls: {
			request: DesktopSessionSearchRequest;
			emit: (event: DesktopSessionSearchEvent) => void;
			cancel: ReturnType<typeof vi.fn>;
		}[] = [];
		vi.stubGlobal("vetta", {
			session: {
				searchSessions: (request: DesktopSessionSearchRequest, emit: (event: DesktopSessionSearchEvent) => void) => {
					const cancel = vi.fn();
					calls.push({ request, emit, cancel });
					return cancel;
				},
			},
		});
		const {
			result: state,
			rerender,
			unmount,
		} = renderHook(({ open, request }) => useSessionSearch(open, request), {
			initialProps: { open: true, request: { query: "he" } as DesktopSessionSearchRequest },
		});
		rerender({ open: true, request: { query: "hello" } });
		await act(() => vi.advanceTimersByTimeAsync(180));
		expect(calls).toHaveLength(1);
		act(() => calls[0].emit({ requestId: "1", results: [result], done: false }));
		expect(state.current.results).toHaveLength(1);
		expect(state.current.loading).toBe(true);
		rerender({ open: true, request: { query: "hello", sourceKind: "project", projectCwd: "cwd" } });
		expect(calls[0].cancel).toHaveBeenCalledOnce();
		expect(state.current.results).toEqual([]);
		act(() => calls[0].emit({ requestId: "1", results: [result], done: true }));
		expect(state.current.results).toEqual([]);
		await act(() => vi.advanceTimersByTimeAsync(180));
		expect(calls[1].request).toMatchObject({ sourceKind: "project", projectCwd: "cwd" });
		act(() => {
			calls[1].emit({ requestId: "2", results: [result, result], done: false });
			calls[1].emit({ requestId: "2", done: true, limited: true, skipped: 1 });
		});
		expect(state.current.results).toHaveLength(1);
		expect(state.current).toMatchObject({ loading: false, limited: true, skipped: 1 });
		rerender({ open: true, request: { query: "hello", modifiedFrom: 10, modifiedBefore: 30, limit: 2 } });
		expect(calls[1].cancel).toHaveBeenCalledOnce();
		await act(() => vi.advanceTimersByTimeAsync(180));
		expect(calls[2].request).toMatchObject({ modifiedFrom: 10, modifiedBefore: 30, limit: 2 });
		const dated = (path: string, modifiedAt: number): DesktopSessionSearchResult => ({
			...result,
			session: { ...result.session, path, modifiedAt },
		});
		act(() => calls[2].emit({ requestId: "3", results: [dated("old", 10)], done: false }));
		expect(state.current.results.map((entry) => entry.session.path)).toEqual(["old"]);
		act(() => calls[2].emit({ requestId: "3", results: [dated("new", 29), dated("middle", 20)], done: false }));
		expect(state.current.results.map((entry) => entry.session.path)).toEqual(["new", "middle"]);
		expect(state.current.loading).toBe(true);
		act(() => calls[1].emit({ requestId: "2", results: [dated("stale", 99)], done: true }));
		expect(state.current.results.map((entry) => entry.session.path)).toEqual(["new", "middle"]);
		rerender({ open: false, request: { query: "hello" } });
		expect(calls[2].cancel).toHaveBeenCalledOnce();
		rerender({ open: true, request: { query: "hello" } });
		await act(() => vi.advanceTimersByTimeAsync(180));
		unmount();
		expect(calls[3].cancel).toHaveBeenCalledOnce();
	});
});
