// @vitest-environment jsdom

import { inlineFilePreviewAtom, openInlineFilePreviewAtom } from "@shared/store/atoms";
import { act, cleanup, render, renderHook } from "@testing-library/react";
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
	await act(async () => {});
	expect(store.get(inlineFilePreviewAtom)).toBeNull();
});

// 面板关着时点开聊天里的文件：预览先写入，文件 tab 随后才挂载。挂载后紧跟的一次卸载再挂载
// （StrictMode 双调用、面板子树重挂）不能把这份预览当成「离场」清掉，否则第一次只打开目录树。
it("keeps a preview opened before the file tab mounts when the tab remounts immediately", async () => {
	const store = createStore();
	store.set(openInlineFilePreviewAtom, { name: "a.md", path: "/a.md" });
	function Probe() {
		useFileTabContentModel();
		return null;
	}
	const view = render(
		<Provider store={store}>
			<Probe key="first" />
		</Provider>,
	);
	view.rerender(
		<Provider store={store}>
			<Probe key="second" />
		</Provider>,
	);
	await act(async () => {});
	expect(store.get(inlineFilePreviewAtom)?.name).toBe("a.md");
	view.unmount();
	await act(async () => {});
	expect(store.get(inlineFilePreviewAtom)).toBeNull();
});
