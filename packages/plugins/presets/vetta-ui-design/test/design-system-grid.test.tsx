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
import { DesignSystemGrid } from "../src/gallery/DesignSystemGrid";
import { markCatalogFailed, resetDesignSystems, setDesignSystems } from "../src/design-systems/registry";
import type { DesignSystem } from "../src/design-systems/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom 没有 IntersectionObserver；demo 预览的懒挂载需要它存在。
class ImmediateIntersectionObserver {
	constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
	observe(): void {
		this.callback([{ isIntersecting: true }]);
	}
	disconnect(): void {}
	unobserve(): void {}
}
vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);

function system(id: string, name: string): DesignSystem {
	return {
		id,
		name,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources: [],
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
	setDesignSystems([system("linear", "Linear"), system("stripe", "Stripe")]);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
	resetDesignSystems();
});

function render(node: React.ReactNode): void {
	act(() => root.render(node));
}

function tiles(): HTMLButtonElement[] {
	return [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
}

describe("DesignSystemGrid", () => {
	it("列出当前生效的全部风格", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles()).toHaveLength(2);
		expect(document.body.textContent).toContain("Linear");
		expect(document.body.textContent).toContain("Stripe");
	});

	it("跟在项目宫格之后时画分隔线，当首屏主角时不画", () => {
		render(<DesignSystemGrid divided busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("section")?.className).toContain("border-t");
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("section")?.className).not.toContain("border-t");
	});

	it("和项目卡片用同一套宫格，不是横向滚动条", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		const grid = document.body.querySelector("section > div");
		expect(grid?.className).toContain("grid");
		expect(grid?.className).not.toContain("overflow-x-auto");
	});

	it("点一张卡把对应的体系交回去", () => {
		const picked: string[] = [];
		render(<DesignSystemGrid busy={false} onPick={(s) => picked.push(s.id)} />);
		act(() => {
			tiles()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual(["stripe"]);
	});

	it("busy 时禁用，避免重复建项目", () => {
		const picked: string[] = [];
		render(<DesignSystemGrid busy onPick={(s) => picked.push(s.id)} />);
		expect(tiles().every((tile) => tile.disabled)).toBe(true);
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual([]);
	});

	it("每张卡都有可读的无障碍名称", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual([
			"gallery.styles.view:Linear",
			"gallery.styles.view:Stripe",
		]);
	});

	it("悬停点燃对应卡片的 demo 预览，移开熄灭", () => {
		const html = "<!doctype html><html><body>demo</body></html>";
		setDesignSystems([
			{
				...system("linear", "Linear"),
				resources: [{ path: "demo.html", role: "demo", encoding: "text", content: html, bytes: html.length }],
			},
			system("stripe", "Stripe"),
		]);
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		const active = (): number => document.body.querySelectorAll("[data-active]").length;
		expect(active()).toBe(0);
		// React 的 onMouseEnter/Leave 由委托的 mouseover/mouseout 驱动。
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		});
		expect(active()).toBe(1);
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
		});
		expect(active()).toBe(0);
	});
});

describe("目录拿不到时的状态", () => {
	it("还在拉时给骨架，不给空白", () => {
		resetDesignSystems();
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(tiles()).toHaveLength(0);
	});

	it("拉不到时给解释和重试按钮", () => {
		resetDesignSystems();
		act(() => markCatalogFailed());
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.textContent).toContain("gallery.styles.offline.title");
		expect(document.body.textContent).toContain("gallery.styles.retry");
		expect(document.body.querySelector('[aria-busy="true"]')).toBeNull();
	});

	it("已经有内容时失败不降级，照常显示列表", () => {
		act(() => markCatalogFailed());
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles()).toHaveLength(2);
		expect(document.body.textContent).not.toContain("gallery.styles.offline.title");
	});
});
