import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "zh" }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AllProjectsView } from "../src/gallery/AllProjectsView";
import { PROJECTS_PAGE_SIZE } from "../src/gallery/gallery-layout";
import type { GalleryCard } from "../src/gallery/gallery-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * happy-dom 没有 IntersectionObserver。这个桩不自动上报，把「哨兵进入视口」的时机
 * 交给测试显式触发——分页行为恰恰是要在这一步前后断言的。
 */
let observers: { callback: (entries: { isIntersecting: boolean }[]) => void }[] = [];
class ManualIntersectionObserver {
	constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
		observers.push(this);
	}
	observe(): void {}
	disconnect(): void {
		observers = observers.filter((entry) => entry !== this);
	}
	unobserve(): void {}
}
vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);

function card(index: number): GalleryCard {
	const design = { vetdPath: `/p${index}/a.vetd`, name: "a", modifiedAt: index };
	return {
		cwd: `/p${index}`,
		name: `project-${index}`,
		designs: [design],
		cover: design,
		modifiedAt: index,
		coverDataUrl: null,
		accent: null,
		running: false,
	};
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	observers = [];
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function render(cards: GalleryCard[]): void {
	act(() => root.render(<AllProjectsView cards={cards} onOpen={() => {}} onCardContextMenu={() => {}} />));
}

function renderedCards(): number {
	return document.body.querySelectorAll("button").length;
}

/** 模拟滚动到底部：让当前挂着的全部哨兵 observer 上报相交。 */
function reachBottom(): void {
	act(() => {
		for (const observer of [...observers]) observer.callback([{ isIntersecting: true }]);
	});
}

describe("AllProjectsView", () => {
	it("首屏只挂一页，滚动到底部追加下一页", () => {
		const total = PROJECTS_PAGE_SIZE + 10;
		render(Array.from({ length: total }, (_, index) => card(index)));
		expect(renderedCards()).toBe(PROJECTS_PAGE_SIZE);
		reachBottom();
		expect(renderedCards()).toBe(total);
	});

	it("全部挂完后哨兵消失，换成到底提示", () => {
		render(Array.from({ length: 3 }, (_, index) => card(index)));
		expect(renderedCards()).toBe(3);
		expect(observers).toHaveLength(0);
		expect(document.body.textContent).toContain("gallery.projects.loadedAll");
	});

	it("卡片集合变化（比如换了搜索词）时分页重置", () => {
		const total = PROJECTS_PAGE_SIZE + 10;
		render(Array.from({ length: total }, (_, index) => card(index)));
		reachBottom();
		expect(renderedCards()).toBe(total);
		render(Array.from({ length: total }, (_, index) => card(index + 1000)));
		expect(renderedCards()).toBe(PROJECTS_PAGE_SIZE);
	});
});
