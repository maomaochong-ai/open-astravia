import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "zh" }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesignResource, DesignSystem } from "../src/design-systems/types";
import { DesignSystemDemo, designSystemDemoHtml } from "../src/gallery/DesignSystemDemo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom 没有 IntersectionObserver；用一个立刻上报「可见」的桩，让懒挂载在测试里生效。
class ImmediateIntersectionObserver {
	constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
	observe(): void {
		this.callback([{ isIntersecting: true }]);
	}
	disconnect(): void {}
	unobserve(): void {}
}
vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);

const DEMO_HTML = "<!doctype html><html><body><h1>Linear</h1></body></html>";

function system(resources: DesignResource[]): DesignSystem {
	return {
		id: "linear",
		name: "Linear",
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources,
		themeCss: "@theme { --color-primary: #000; }",
		designMd: "# Linear",
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

function frame(): HTMLIFrameElement | null {
	return document.body.querySelector("iframe");
}

describe("designSystemDemoHtml", () => {
	it("取 demo 角色的正文", () => {
		expect(designSystemDemoHtml(withDemo)).toBe(DEMO_HTML);
	});

	it("没有 demo 角色时为 null", () => {
		expect(designSystemDemoHtml(system([]))).toBeNull();
		expect(
			designSystemDemoHtml(
				system([{ path: "theme.css", role: "theme", encoding: "text", content: "@theme {}", bytes: 9 }]),
			),
		).toBeNull();
	});

	it("demo 是二进制时不当 HTML 用", () => {
		expect(
			designSystemDemoHtml(
				system([{ path: "demo.html", role: "demo", encoding: "binary", url: "https://x/y", bytes: 10 }]),
			),
		).toBeNull();
	});
});

describe("DesignSystemDemo", () => {
	it("把 demo 渲染进 iframe", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active={false} />));
		expect(frame()?.getAttribute("srcdoc")).toBe(DEMO_HTML);
	});

	it("iframe 不给脚本执行权——这是远端 HTML 的安全边界", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active={false} />));
		const sandbox = frame()?.getAttribute("sandbox") ?? "";
		// allow-same-origin 只用来量高度；allow-scripts 一旦给出，远端 HTML 就能执行代码。
		expect(sandbox).toBe("allow-same-origin");
		expect(sandbox).not.toContain("allow-scripts");
		expect(sandbox).not.toContain("allow-popups");
		expect(sandbox).not.toContain("allow-forms");
	});

	it("预览不吃鼠标事件，点击仍然落在卡片上", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active={false} />));
		expect(frame()?.className).toContain("pointer-events-none");
	});

	it("对无障碍树隐藏：可读信息在卡片文字部分", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active={false} />));
		expect(document.body.querySelector("[aria-hidden]")).not.toBeNull();
	});

	it("没有 demo 时什么都不渲染", () => {
		act(() => root.render(<DesignSystemDemo system={system([])} active={false} />));
		expect(frame()).toBeNull();
	});

	it("iframe 还没 load 时预览层是透明的，底下露着色板", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active={false} />));
		expect(frame()?.parentElement?.style.opacity).toBe("0");
	});

	it("iframe load 之后预览层才淡入", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active={false} />));
		act(() => {
			frame()?.dispatchEvent(new Event("load"));
		});
		expect(frame()?.parentElement?.style.opacity).toBe("1");
	});

	it("内容不比视口高时不加滚动动画", () => {
		act(() => root.render(<DesignSystemDemo system={withDemo} active />));
		// jsdom 量不到真实高度（scrollHeight 为 0），退回单屏：静止，不假装在滚。
		expect(frame()?.style.animation ?? "").toBe("");
	});
});
