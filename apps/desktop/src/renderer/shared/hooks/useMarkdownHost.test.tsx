// @vitest-environment jsdom
import { filePreviewAtom } from "@shared/store/atoms";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMarkdownHost } from "./useMarkdownHost";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("resolves local Markdown images, exports SVG through the native dialog and closes a launched HTML preview", async () => {
	const callbacks: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
	const read = vi.fn(async (_path: string) => ({ content: "aW1hZ2U=", encoding: "base64" }));
	const save = vi.fn(async () => "C:/saved/image.svg");
	const openHtml = vi.fn(async () => "preview-id");
	const closeHtml = vi.fn(async () => {});
	Object.defineProperty(window, "vetta", { configurable: true, value: { fs: { readFile: read }, dialog: { saveData: save }, markdown: { openHtml, closeHtml } } });
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
	const { result } = renderHook(() => useMarkdownHost("C:/project/docs"), { wrapper });
	await expect(result.current.resolveImage("../assets/example.png")).resolves.toBe("data:image/png;base64,aW1hZ2U=");
	// Resolution normalizes the path; Main's filesystem service retains project permission checks.
	const path = read.mock.calls[0]?.[0];
	expect(path).toBe("C:/project/assets/example.png");
	act(() => result.current.openImage("data:image/svg+xml,%3Csvg/%3E", "Diagram"));
	expect(store.get(filePreviewAtom)).toMatchObject({ name: "Diagram.svg", kind: "image" });
	await result.current.saveImage("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
	expect(save).toHaveBeenCalledWith("image.svg", "<svg/>", "utf8");
	const opening = result.current.openHtml("<button>Run</button>");
	expect(openHtml).not.toHaveBeenCalled();
	await act(async () => { while (callbacks.length) callbacks.shift()?.(0); });
	const close = await opening;
	expect(openHtml).toHaveBeenCalledWith("<button>Run</button>");
	close();
	expect(closeHtml).toHaveBeenCalledWith("preview-id");
});
