// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePetWidgetLayout } from "./usePetWidgetLayout";

class FakeResizeObserver {
	callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function mockRect(element: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
		x: rect.left,
		y: rect.top,
		left: rect.left,
		top: rect.top,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		width: rect.width,
		height: rect.height,
		toJSON() {
			return rect;
		},
	});
}

describe("usePetWidgetLayout", () => {
	let setContentSize: ReturnType<typeof vi.fn>;
	let setVideoHitbox: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		setContentSize = vi.fn().mockResolvedValue(undefined);
		setVideoHitbox = vi.fn().mockResolvedValue(undefined);
		window.vettaPet = {
			onCommand: () => () => undefined,
			resizeByWheel: async () => undefined,
			resizeVideoByWheel: async () => undefined,
			beginWindowMove: async () => undefined,
			moveWindow: async () => undefined,
			endWindowMove: async () => undefined,
			beginWindowResize: async () => undefined,
			setWindowSize: async () => undefined,
			setContentSize,
			endWindowResize: async () => undefined,
			setVideoBaseSize: async () => undefined,
			setMousePassthrough: async () => undefined,
			setVideoHitbox,
		};
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
		Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete window.vettaPet;
	});

	it("reports the sprite hitbox and widget content size so the main process can shrink the overlay window", () => {
		const shell = document.createElement("div");
		const video = document.createElement("div");
		document.body.append(shell, video);
		mockRect(shell, { left: 0, top: 0, width: 360, height: 300 });
		mockRect(video, { left: 70, top: 80, width: 220, height: 220 });
		const shellRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;
		const videoRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;
		shellRef.current = shell;
		videoRef.current = video;

		renderHook(() => usePetWidgetLayout({ shellRef, videoRef }));

		expect(setContentSize).toHaveBeenCalledWith({
			bounds: { x: 0, y: 0, width: 360, height: 300 },
			anchor: { x: 70, y: 80, width: 220, height: 220 },
		});
		expect(setVideoHitbox).toHaveBeenCalledWith({ x: 70, y: 80, width: 220, height: 220 });
		expect(setContentSize.mock.invocationCallOrder[0] ?? 0).toBeLessThan(setVideoHitbox.mock.invocationCallOrder[0] ?? 0);

		shell.remove();
		video.remove();
	});
});
