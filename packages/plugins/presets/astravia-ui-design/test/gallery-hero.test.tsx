import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 画廊 Hero：门面同时是两条主入口。这里钉住的是它的行为契约——
 * 数字只反映真实存在的东西（空库不吹「0 个项目」）、两个按钮各自回调、busy 时不可点。
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
	const onCreate = vi.fn();
	const onKeywordChange = vi.fn();
	const onRefresh = vi.fn();
	const onImport = vi.fn();
	act(() => {
		root.render(
			<GalleryHero
				projectCount={4}
				designCount={9}
				empty={false}
				loading={false}
				busy={false}
				keyword=""
				onKeywordChange={onKeywordChange}
				onRefresh={onRefresh}
				onImport={onImport}
				onCreate={onCreate}
				{...props}
			/>,
		);
	});
	return { onCreate, onKeywordChange, onRefresh, onImport };
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

	it("空库时只留风格数，不渲染项目/设计统计", () => {
		mount({ empty: true, projectCount: 0, designCount: 0 });
		expect([...host.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
			'gallery.hero.stat.styles|{"count":2}',
		]);
	});

	it("风格库还没拉到时不显示风格数", () => {
		systems.current = [];
		mount({ empty: true, projectCount: 0, designCount: 0 });
		expect(host.querySelectorAll("li")).toHaveLength(0);
	});

	it("Hero 自带首页工具栏：搜索、刷新、导入各自回调，标题与描述不再渲染", () => {
		const { onKeywordChange, onRefresh, onImport } = mount();

		expect(host.textContent).not.toContain("gallery.hero.title");
		expect(host.textContent).not.toContain("gallery.hero.subtitle");

		const input = host.querySelector<HTMLInputElement>('input[aria-label="gallery.search"]');
		expect(input).not.toBeNull();
		act(() => {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			setter?.call(input, "alpha");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(onKeywordChange).toHaveBeenCalledWith("alpha");

		act(() => host.querySelector<HTMLButtonElement>('[aria-label="gallery.action.refresh"]')?.click());
		expect(onRefresh).toHaveBeenCalledOnce();

		act(() => buttonWith("gallery.action.import")?.click());
		expect(onImport).toHaveBeenCalledOnce();
	});

	it("刷新中不可重复点，按钮进入 loading 态", () => {
		const { onRefresh } = mount({ loading: true });
		const refresh = host.querySelector<HTMLButtonElement>('[aria-label="gallery.action.refresh"]');
		expect(refresh?.disabled).toBe(true);
		act(() => refresh?.click());
		expect(onRefresh).not.toHaveBeenCalled();
	});

	it("新建按钮回调，busy 时不可点", () => {
		const { onCreate } = mount();
		act(() => buttonWith("gallery.hero.create")?.click());
		expect(onCreate).toHaveBeenCalledOnce();

		const busy = mount({ busy: true });
		expect(buttonWith("gallery.hero.create")?.disabled).toBe(true);
		act(() => buttonWith("gallery.hero.create")?.click());
		expect(busy.onCreate).not.toHaveBeenCalled();
	});
});
