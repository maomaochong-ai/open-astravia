import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 画廊 Hero：只负责门面与真实统计。动作（搜索/新建/导入/刷新）在宿主页头，
 * 这里钉住的是：数字只反映真实存在的东西（空库不吹「0 个项目」），
 * 以及 Hero 不再自己长出工具栏——那会让滚走后再也点不到新建。
 */

vi.mock("@astravia-org/plugin-sdk", () => {
	const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key);
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

const systems = vi.hoisted(() => ({ current: [] as Array<{ id: string }> }));
vi.mock("../src/design-systems/index", () => ({
	useCatalogState: () => ({ systems: systems.current, status: "ready" }),
	refreshDesignCatalog: vi.fn(),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryHero } from "../src/gallery/GalleryHero";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	systems.current = [{ id: "a" }, { id: "b" }];
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function mount(props: Partial<React.ComponentProps<typeof GalleryHero>> = {}) {
	const onBrowseStyles = vi.fn();
	act(() => {
		root.render(
			<GalleryHero projectCount={4} designCount={9} empty={false} onBrowseStyles={onBrowseStyles} {...props} />,
		);
	});
	return { onBrowseStyles };
}

function buttonWith(text: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
}

describe("画廊 Hero", () => {
	it("有内容时给出项目 / 设计 / 风格三项真实统计", () => {
		mount();
		const stats = host.querySelectorAll("li");
		expect([...stats].map((item) => item.textContent)).toEqual([
			'gallery.hero.stat.projects|{"count":4}',
			'gallery.hero.stat.designs|{"count":9}',
			'gallery.hero.stat.styles|{"count":2}',
		]);
	});

	it("空库时只留风格数，并换成引导性副标题", () => {
		mount({ empty: true, projectCount: 0, designCount: 0 });
		expect([...host.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
			'gallery.hero.stat.styles|{"count":2}',
		]);
		expect(host.textContent).toContain("gallery.hero.subtitle.empty");
		expect(host.textContent).not.toContain("gallery.hero.subtitle|");
	});

	it("风格库还没拉到时不显示风格数", () => {
		systems.current = [];
		mount({ empty: true, projectCount: 0, designCount: 0 });
		expect(host.querySelectorAll("li")).toHaveLength(0);
	});

	it("不再自己渲染搜索/新建/导入/刷新，只留「逛逛风格库」", () => {
		const { onBrowseStyles } = mount();

		expect(host.querySelector('input[aria-label="gallery.search"]')).toBeNull();
		expect(host.querySelector('[aria-label="gallery.action.refresh"]')).toBeNull();
		expect(buttonWith("gallery.action.import")).toBeUndefined();
		expect(buttonWith("gallery.hero.create")).toBeUndefined();

		act(() => buttonWith("gallery.hero.browseStyles")?.click());
		expect(onBrowseStyles).toHaveBeenCalledOnce();
	});
});
