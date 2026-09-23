// @vitest-environment jsdom

import { inlineFilePreviewAtom, openInlineFilePreviewAtom } from "@shared/store/atoms";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFileTabContentModel } from "./useFileTabContentModel";

let frames: FrameRequestCallback[];

beforeEach(() => {
	frames = [];
	vi.useFakeTimers();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
	Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function paintFrame(): Promise<void> {
	await act(async () => {
		const pending = frames.splice(0);
		for (const frame of pending) frame(performance.now());
	});
}

function setup() {
	const store = createStore();
	function Wrapper({ children }: PropsWithChildren) {
		return <Provider store={store}>{children}</Provider>;
	}
	return { store, ...renderHook(useFileTabContentModel, { wrapper: Wrapper }) };
}

it("opens the preview shell immediately, loads after paint, and keeps next/previous navigation ready", async () => {
	const { store, result } = setup();
	act(() => store.set(openInlineFilePreviewAtom, {
		items: [{ name: "a.ts", path: "/a.ts" }, { name: "b.ts", path: "/b.ts" }],
		index: 0,
	}));
	expect(result.current.showPreview).toBe(true);
	expect(result.current.previewMounted).toBe(false);
	await paintFrame();
	expect(result.current.previewMounted).toBe(false);
	await paintFrame();
	expect(result.current.previewMounted).toBe(true);
	act(() => result.current.goNext());
	expect(result.current.previewCtx?.index).toBe(1);
	expect(result.current.previewMounted).toBe(true);
	act(() => result.current.goPrev());
	expect(result.current.previewCtx?.index).toBe(0);
	act(() => result.current.closePreview());
	expect(result.current.showPreview).toBe(false);
});

it("does not let a closed preview's pending paint mount a newly opened preview early", async () => {
	const { store, result, unmount } = setup();
	act(() => store.set(openInlineFilePreviewAtom, { name: "a.ts", path: "/a.ts" }));
	await paintFrame();
	act(() => result.current.closePreview());
	act(() => store.set(openInlineFilePreviewAtom, { name: "b.ts", path: "/b.ts" }));
	await paintFrame();
	expect(result.current.previewMounted).toBe(false);
	await paintFrame();
	expect(result.current.previewMounted).toBe(true);
	expect(result.current.previewCtx?.items[0]?.name).toBe("b.ts");
	unmount();
	expect(store.get(inlineFilePreviewAtom)).toBeNull();
});
