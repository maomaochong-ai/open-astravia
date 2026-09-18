import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplateGalleryDialog } from "../src/cards/TemplateGalleryDialog";

/** React 19 的 act 需要这个开关，否则每次更新都会告警。 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function queryByLabel(label: string): HTMLElement {
	const element = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
	if (!element) throw new Error(`missing element: ${label}`);
	return element;
}

function fire(target: HTMLElement, type: string): void {
	act(() => {
		target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
	});
}

describe("TemplateGalleryDialog", () => {
	it("closes on the header close button", () => {
		const onClose = vi.fn();
		act(() => {
			root.render(<TemplateGalleryDialog onApply={vi.fn()} onClose={onClose} />);
		});

		fire(queryByLabel("ds.close"), "click");

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	// 画布入口把 Dialog 挂在画布根之下：portal 只逃出了 DOM，React 事件仍沿组件树冒泡。
	// 画布根的 pointerdown 会 setPointerCapture 并把随后的 click 改派给自己，Dialog 里
	// 的按钮就全点不动了——所以指针事件必须在蒙层这一层被吃掉。
	it("keeps pointer events from reaching the React-tree ancestor", () => {
		const onPointerDown = vi.fn();
		act(() => {
			root.render(
				// biome-ignore lint/a11y/noStaticElementInteractions: stands in for the canvas root
				<div onPointerDown={onPointerDown}>
					<TemplateGalleryDialog onApply={vi.fn()} onClose={vi.fn()} />
				</div>,
			);
		});

		fire(queryByLabel("ds.close"), "pointerdown");

		expect(onPointerDown).not.toHaveBeenCalled();
	});
});
