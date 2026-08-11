import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) =>
			params ? `${key}:${Object.values(params).join(",")}` : key,
		locale: "zh",
	}),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesignResource, DesignSystem } from "../src/design-systems/types";
import { DesignSystemDetailDialog } from "../src/gallery/DesignSystemDetailDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom 没有 IntersectionObserver；demo 大图预览的懒挂载需要它。
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

function system(resources: DesignResource[] = []): DesignSystem {
	return {
		id: "linear",
		name: "Linear",
		category: "dev",
		vibe: "dark",
		blurb: "Crisp dark tooling UI",
		resources,
		themeCss: "@theme { --color-primary: #5e6ad2; --color-accent: #26b5ce; }",
		designMd: "# Linear",
		license: "MIT",
	};
}

const withDemo = system([
	{ path: "demo.html", role: "demo", encoding: "text", content: DEMO_HTML, bytes: DEMO_HTML.length },
]);

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

function render(node: React.ReactNode): void {
	act(() => root.render(node));
}

function buttonByText(text: string): HTMLButtonElement | null {
	return (
		[...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
			(button.textContent ?? "").includes(text),
		) ?? null
	);
}

describe("DesignSystemDetailDialog", () => {
	it("展示名称、分类、标语与配色", () => {
		render(<DesignSystemDetailDialog system={withDemo} busy={false} onUse={() => {}} onClose={() => {}} />);
		expect(document.body.textContent).toContain("Linear");
		expect(document.body.textContent).toContain("Crisp dark tooling UI");
		// 配色条来自 theme.css 的 token。
		expect(document.body.querySelector('[title^="primary"]')).not.toBeNull();
	});

	it("有 demo 时用常开滚动的真实预览", () => {
		render(<DesignSystemDetailDialog system={withDemo} busy={false} onUse={() => {}} onClose={() => {}} />);
		expect(document.body.querySelector("iframe")?.getAttribute("srcdoc")).toBe(DEMO_HTML);
		expect(document.body.querySelector("[data-active]")).not.toBeNull();
	});

	it("右下角「使用」把这套体系交回去", () => {
		const used: string[] = [];
		render(
			<DesignSystemDetailDialog system={withDemo} busy={false} onUse={(s) => used.push(s.id)} onClose={() => {}} />,
		);
		const use = buttonByText("gallery.detail.use");
		expect(use).not.toBeNull();
		act(() => {
			use?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(used).toEqual(["linear"]);
	});

	it("busy 时「使用」禁用，避免重复建项目", () => {
		render(<DesignSystemDetailDialog system={withDemo} busy onUse={() => {}} onClose={() => {}} />);
		expect(buttonByText("gallery.detail.use")?.disabled).toBe(true);
	});

	it("只有带 demo 的体系才有「在浏览器打开」", () => {
		render(<DesignSystemDetailDialog system={withDemo} busy={false} onUse={() => {}} onClose={() => {}} />);
		expect(buttonByText("gallery.detail.openDemo")).not.toBeNull();
		render(<DesignSystemDetailDialog system={system()} busy={false} onUse={() => {}} onClose={() => {}} />);
		expect(buttonByText("gallery.detail.openDemo")).toBeNull();
	});

	it("Esc 关闭", () => {
		const closed: true[] = [];
		render(
			<DesignSystemDetailDialog system={withDemo} busy={false} onUse={() => {}} onClose={() => closed.push(true)} />,
		);
		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(closed).toEqual([true]);
	});
});
