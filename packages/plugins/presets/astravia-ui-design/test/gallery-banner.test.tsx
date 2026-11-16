import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) =>
			params ? `${key}:${Object.values(params).join(",")}` : key,
		locale: "zh",
	}),
}));

const catalog = vi.hoisted(() => ({ systems: [] as Array<{ id: string; name: string }>, status: "ready" as "loading" | "ready" | "failed" }));
vi.mock("../src/design-systems/index", () => ({
	useCatalogState: () => ({ systems: catalog.systems, status: catalog.status }),
	refreshDesignCatalog: vi.fn(),
}));

// 轮播瓷砖用真实 DesignSystemPreview，它解析 themeCss 取 token；这里给一个能解析的最小样式。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryBanner } from "../src/gallery/GalleryBanner";
import type { DesignSystem } from "../src/design-systems/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function system(id: string, name: string): DesignSystem {
	return {
		id,
		name,
		category: "dev",
		vibe: "dark",
		blurb: `${name} blurb`,
		tagline: { en: `${name} tagline`, zh: `${name} 摘要` },
		resources: [],
		themeCss: "@theme { --color-primary: #5e6ad2; }",
		designMd: `# ${name}`,
	};
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	catalog.systems = [];
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

function buttons(): HTMLButtonElement[] {
	return [...document.body.querySelectorAll<HTMLButtonElement>("button")];
}

describe("GalleryBanner", () => {
	it("有风格时渲染轮播，推荐第一套的名字与摘要", () => {
		catalog.systems = [system("linear", "Linear"), system("stripe", "Stripe")];
		render(<GalleryBanner onPick={() => {}} />);
		expect(document.body.textContent).toContain("Linear");
		expect(document.body.textContent).toContain("Linear 摘要");
	});

	it("一套风格都没有时整块不渲染", () => {
		render(<GalleryBanner onPick={() => {}} />);
		expect(document.body.querySelector("button")).toBeNull();
	});

	it("风格库还在拉时铺同高骨架，而不是整块不渲染", () => {
		catalog.status = "loading";
		render(<GalleryBanner onPick={() => {}} />);
		// 骨架是 aria-hidden 的占位块，没有按钮也没有轮播点。
		expect(document.body.querySelector("button")).toBeNull();
		expect(document.body.querySelector(".animate-pulse")).not.toBeNull();
		catalog.status = "ready";
	});

	it("轮播点数量等于推荐套数，且首张是当前", () => {
		catalog.systems = [system("a", "A"), system("b", "B"), system("c", "C")];
		render(<GalleryBanner onPick={() => {}} />);
		// 轮播点是带 aria-current 的按钮（3 个），CTA 按钮 1 个。
		const dots = buttons().filter((button) => button.getAttribute("aria-current") !== null);
		expect(dots).toHaveLength(3);
		expect(dots[0]?.getAttribute("aria-current")).toBe("true");
	});

	it("点「查看详情」把当前推荐的那套交回去", () => {
		catalog.systems = [system("linear", "Linear"), system("stripe", "Stripe")];
		const picked: string[] = [];
		render(<GalleryBanner onPick={(s) => picked.push(s.id)} />);
		const cta = buttons().find((button) => button.textContent?.includes("gallery.banner.cta"));
		act(() => {
			cta?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual(["linear"]);
	});
});
