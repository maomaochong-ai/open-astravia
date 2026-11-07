// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { useActivityTabMaximize } from "./useActivityTabMaximize";

function setRowWidth(element: HTMLElement, width: number): void {
	Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
}

function Harness(): JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	const model = useActivityTabMaximize(ref);
	return (
		<div data-testid="row">
			<div ref={ref} data-testid="panel" data-width={model.width} data-maximized={model.isMaximized} />
			<button type="button" onClick={model.toggle}>
				toggle
			</button>
		</div>
	);
}

describe("useActivityTabMaximize", () => {
	let container: HTMLDivElement;
	let root: Root;
	let resizeCallbacks: Array<() => void>;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		resizeCallbacks = [];
		// 面板靠内容行的实测宽度铺满；jsdom 没有布局，这里给出可变的宽度。
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			constructor(callback: () => void) {
				resizeCallbacks.push(callback);
			}
			observe(): void {}
			disconnect(): void {}
		};
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
	});

	it("铺满时按内容行宽度展开，再点一次回到原状", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]');
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement | null;
		if (!row || !panel) throw new Error("harness did not render");
		setRowWidth(row as HTMLElement, 1280);

		expect(panel.dataset.maximized).toBe("false");
		expect(panel.dataset.width).toBe("0");

		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("true");
		expect(panel.dataset.width).toBe("1280");

		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("false");
		expect(panel.dataset.width).toBe("0");
	});

	it("窗口或侧边栏变化时重新取行宽，不把面板留在旧尺寸上", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]') as HTMLElement;
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
		setRowWidth(row, 1280);
		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.width).toBe("1280");

		setRowWidth(row, 960);
		act(() => {
			for (const callback of resizeCallbacks) callback();
		});
		expect(panel.dataset.width).toBe("960");
	});

	it("Esc 退出铺满", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]') as HTMLElement;
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
		setRowWidth(row, 1280);
		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("true");

		act(() => {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(panel.dataset.maximized).toBe("false");
	});
});
