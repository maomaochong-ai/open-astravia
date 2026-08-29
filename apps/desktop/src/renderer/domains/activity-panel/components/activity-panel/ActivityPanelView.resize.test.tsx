// @vitest-environment jsdom

import { ActivityPanelView } from "@vetta/theme-ui/activity";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";

vi.mock("motion/react", () => ({
	AnimatePresence: ({ children }: { children: ReactNode }) => children,
	motion: { div: ({ children }: { children: ReactNode }) => createElement("div", null, children) },
}));

function frame({ children }: ActivityPanelFrameProps): ReturnType<typeof createElement> {
	return createElement("div", { "data-frame": "" }, children as ReactNode);
}

function pointerEvent(type: string, clientX: number): Event {
	return new MouseEvent(type, { bubbles: true, clientX });
}

describe("ActivityPanelView resize shell", () => {
	let container: HTMLDivElement;
	let root: Root;
	let nextFrameId: number;
	let frames: Map<number, FrameRequestCallback>;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		nextFrameId = 1;
		frames = new Map();
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			const id = nextFrameId++;
			frames.set(id, callback);
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	it("keeps content mounted while the local shell follows coalesced pointer movement", () => {
		const onResizeStart = vi.fn();
		const onResize = vi.fn();
		const onResizeEnd = vi.fn();
		let contentRenders = 0;
		function Content(): JSX.Element {
			contentRenders += 1;
			return <div>preview</div>;
		}

		act(() => {
			root.render(
				<ActivityPanelView
					Frame={frame}
					isOpen
					isResizing={false}
					width={360}
					minWidth={320}
					maxWidth={800}
					narrowSheet={false}
					bottomSheet={false}
					tabBar={null}
					panelContent={<Content />}
					onClose={vi.fn()}
					onResizeStart={onResizeStart}
					onResize={onResize}
					onResizeEnd={onResizeEnd}
				/>,
			);
		});

		const handle = container.querySelector<HTMLElement>('[data-resize-handle="left"]');
		const aside = container.querySelector("aside");
		expect(handle).not.toBeNull();
		expect(contentRenders).toBe(1);

		act(() => handle?.dispatchEvent(pointerEvent("pointerdown", 500)));
		expect(onResizeStart).toHaveBeenCalledTimes(1);

		act(() => {
			document.dispatchEvent(pointerEvent("pointermove", 480));
			document.dispatchEvent(pointerEvent("pointermove", 450));
			for (const callback of frames.values()) callback(0);
			frames.clear();
		});

		expect(onResize).toHaveBeenLastCalledWith(410);
		expect(aside?.style.width).toBe("410px");
		expect(aside?.style.transition).toBe("none");
		expect(contentRenders).toBe(1);

		act(() => document.dispatchEvent(pointerEvent("pointerup", 450)));
		expect(onResizeEnd).toHaveBeenCalledWith(410);
		expect(contentRenders).toBe(1);
	});
});
