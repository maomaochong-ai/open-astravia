import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplateGalleryDialog } from "../src/cards/TemplateGalleryDialog";
import { resetDesignSystems, setDesignSystems } from "../src/design-systems/registry";
import type { DesignSystem } from "../src/design-systems/types";

/** React 19 的 act 需要这个开关，否则每次更新都会告警。 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ImmediateIntersectionObserver {
	constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
	observe(): void {
		this.callback([{ isIntersecting: true }]);
	}
	disconnect(): void {}
	unobserve(): void {}
}
vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);

const DEMO_HTML = "<!doctype html><html><body>demo</body></html>";

function system(id: string, name: string): DesignSystem {
	return {
		id,
		name,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources: [{ path: "demo.html", role: "demo", encoding: "text", content: DEMO_HTML, bytes: DEMO_HTML.length }],
		themeCss: "@theme { --color-primary: #000; }",
		designMd: `# ${name}`,
	};
}

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
	resetDesignSystems();
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

	it("打开时只铺色板，悬停才挂 HTML demo", () => {
		setDesignSystems([system("linear", "Linear"), system("stripe", "Stripe")]);
		act(() => {
			root.render(<TemplateGalleryDialog onApply={vi.fn()} onClose={vi.fn()} />);
		});
		expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
		const tiles = [...document.body.querySelectorAll("button")].filter((button) =>
			button.textContent?.includes("Linear"),
		);
		expect(tiles[0]).toBeDefined();
		act(() => {
			tiles[0]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		});
		expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
		act(() => {
			tiles[0]?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
		});
		expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
	});
});
