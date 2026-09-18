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
import { SectionHeader } from "../src/gallery/SectionHeader";
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

class StubResizeObserver {
	observe(): void {}
	disconnect(): void {}
	unobserve(): void {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

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

	it("默认画出风格分区标题", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("h2")?.textContent).toBe("gallery.styles.title");
		expect(document.body.textContent).toContain("gallery.styles.hint");
	});

	it("父级已画出标题时 hideHeader 不再叠第二个 h2", () => {
		render(
			<section>
				<SectionHeader title="gallery.styles.title" hint="gallery.styles.hint" />
				<DesignSystemGrid hideHeader busy={false} onPick={() => {}} />
			</section>,
		);
		expect([...document.body.querySelectorAll("h2")].map((node) => node.textContent)).toEqual([
			"gallery.styles.title",
		]);
		expect(tiles()).toHaveLength(2);
	});

	it("跟在项目宫格之后时画分隔线，当首屏主角时不画", () => {
		render(<DesignSystemGrid divided busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("section")?.className).toContain("border-t");
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("section")?.className).not.toContain("border-t");
	});

	it("和项目卡片用同一套宫格，不是横向滚动条", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		const grid = document.body.querySelector("section .grid");
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

	it("悬停才挂 HTML demo，移开卸掉 iframe", () => {
		const html = "<!doctype html><html><body>demo</body></html>";
		setDesignSystems([
			{
				...system("linear", "Linear"),
				resources: [{ path: "demo.html", role: "demo", encoding: "text", content: html, bytes: html.length }],
			},
			{
				...system("stripe", "Stripe"),
				resources: [{ path: "demo.html", role: "demo", encoding: "text", content: html, bytes: html.length }],
			},
		]);
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
		expect(document.body.querySelectorAll("[data-active]")).toHaveLength(0);
		// React 的 onMouseEnter/Leave 由委托的 mouseover/mouseout 驱动。
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		});
		expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
		expect(document.body.querySelectorAll("[data-active]")).toHaveLength(1);
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
		});
		expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
		expect(document.body.querySelectorAll("[data-active]")).toHaveLength(0);
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

describe("风格库窗口化", () => {
	it("只渲染视口附近的行，不把整面墙一次性挂上", () => {
		const previousHeight = window.innerHeight;
		Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
		setDesignSystems(Array.from({ length: 30 }, (_, index) => system(`s${index}`, `Style ${index}`)));
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles().length).toBeGreaterThan(0);
		expect(tiles().length).toBeLessThan(30);
		expect(document.body.textContent).toContain("Style 0");
		Object.defineProperty(window, "innerHeight", { configurable: true, value: previousHeight });
	});
});

