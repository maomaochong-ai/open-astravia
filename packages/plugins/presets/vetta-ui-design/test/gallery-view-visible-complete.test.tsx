// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 画廊可见完成 vs 功能就绪：
 * - 只有 GalleryHeroShell 是纯标题薄壳；GalleryView 第一次提交就可以带上风格墙；
 * - 风格墙以 hideHeader 挂上，不能再画一遍标题；
 * - 项目扫描 / 风格清单仍等第一帧绘制，避免和标题抢 IPC；
 * - 全部设计页在列表 chunk 未到时主区仍有标题，不能是空白。
 */

vi.mock("@vetta-org/plugin-sdk", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

const firstPaint = vi.hoisted(() => ({ ready: false }));
vi.mock("../src/gallery/after-first-paint", () => ({
	useAfterFirstPaint: () => firstPaint.ready,
}));

const galleryCache = vi.hoisted(() => ({
	current: null as { cards: unknown[]; workspacePath: string } | null,
}));
const loadGallery = vi.hoisted(() =>
	vi.fn(async () => galleryCache.current ?? { cards: [], workspacePath: "/w" }),
);
vi.mock("../src/gallery/gallery-store", () => ({
	getCachedSnapshot: () => galleryCache.current,
	isGalleryCacheFresh: () => galleryCache.current !== null,
	isGalleryCoverCacheComplete: () => galleryCache.current !== null,
	isGalleryAbortError: (error: unknown) => error instanceof Error && error.name === "AbortError",
	loadGallery: (...args: unknown[]) => loadGallery(...args),
}));

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ ui: { setWorkspaceViewHeader: vi.fn() } }),
	notify: vi.fn(),
}));

vi.mock("../src/design-systems/index", () => ({
	refreshDesignCatalog: vi.fn(),
	useCatalogState: () => ({ systems: [], status: "ready" }),
	catalogState: () => ({ systems: [], status: "ready" }),
}));

const gridRender = vi.hoisted(() => vi.fn());
vi.mock("../src/gallery/DesignSystemGrid", () => ({
	DesignSystemGrid: (props: { hideHeader?: boolean }) => {
		gridRender(props);
		return (
			<div data-grid="styles">
				{props.hideHeader ? null : <h2>gallery.styles.title</h2>}
				<p>style-grid-body</p>
			</div>
		);
	},
}));

vi.mock("../src/gallery/AllProjectsView", () => ({
	AllProjectsView: () => {
		throw new Promise<void>(() => undefined);
	},
}));

vi.mock("../src/gallery/GalleryCard", () => ({
	GalleryCard: ({ card }: { card: { name: string } }) => <div data-card={card.name} />,
}));
vi.mock("../src/gallery/CardContextMenu", () => ({ CardContextMenu: () => null }));
vi.mock("../src/gallery/CreateDesignDialog", () => ({ CreateDesignDialog: () => null }));
vi.mock("../src/gallery/DesignSystemDetailDialog", () => ({ DesignSystemDetailDialog: () => null }));
vi.mock("../src/canvas/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("../src/gallery/use-gallery-columns", () => ({
	useGalleryColumns: () => ({ ref: { current: null }, columns: 1 }),
}));
vi.mock("../src/gallery/open-project", () => ({
	openProjectFromGallery: vi.fn(),
	startDesignProject: vi.fn(),
}));
vi.mock("../src/gallery/start-from-system", () => ({ startDesignFromSystem: vi.fn() }));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryView } from "../src/gallery/GalleryView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function project(name: string) {
	const design = { vetdPath: `/w/${name}/${name}.vetd`, name, modifiedAt: 0 };
	return { cwd: `/w/${name}`, name, designs: [design], cover: design, modifiedAt: 0 };
}

const CARDS = [project("alpha"), project("beta"), project("gamma"), project("delta")];

let host: HTMLDivElement;
let root: Root;

function styleHeadings(): string[] {
	return [...host.querySelectorAll("h2")]
		.map((node) => node.textContent ?? "")
		.filter((text) => text === "gallery.styles.title");
}

function headingTexts(): string[] {
	return [...host.querySelectorAll("h1, h2")].map((node) => node.textContent ?? "");
}

beforeEach(() => {
	firstPaint.ready = false;
	gridRender.mockClear();
	loadGallery.mockClear();
	galleryCache.current = { cards: [], workspacePath: "/w" };
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

async function mount(): Promise<void> {
	await act(async () => {
		root.render(<GalleryView />);
	});
}

async function paint(): Promise<void> {
	firstPaint.ready = true;
	await act(async () => {
		root.render(<GalleryView />);
	});
}

describe("GalleryView 风格分区可见完成", () => {
	it("Given 空库首页, When GalleryView 第一次提交, Then 风格标题和风格墙一起在且不重复 h2", async () => {
		await mount();

		expect(host.textContent).toContain("gallery.hero.title");
		expect(host.textContent).toContain("gallery.styles.title");
		expect(host.textContent).toContain("gallery.styles.hint");
		expect(host.textContent).toContain("style-grid-body");
		expect(gridRender).toHaveBeenCalled();
		expect(gridRender.mock.calls.every((call) => call[0]?.hideHeader === true)).toBe(true);
		expect(styleHeadings()).toEqual(["gallery.styles.title"]);
	});

	it("Given 已有作品的首页, When GalleryView 第一次提交, Then 我的设计、风格标题和风格墙都在", async () => {
		galleryCache.current = { cards: CARDS, workspacePath: "/w" };
		await mount();

		expect(host.textContent).toContain("gallery.section.mine");
		expect(host.textContent).toContain("gallery.styles.title");
		expect(host.textContent).toContain("style-grid-body");
		expect(gridRender).toHaveBeenCalled();
		expect(styleHeadings()).toEqual(["gallery.styles.title"]);
	});

	it("Given 风格墙已在首帧挂上, When 第一帧绘制完成, Then 仍是同一份 hideHeader 宫格", async () => {
		galleryCache.current = { cards: CARDS, workspacePath: "/w" };
		await mount();
		await paint();

		expect(host.textContent).toContain("style-grid-body");
		expect(gridRender.mock.calls.every((call) => call[0]?.hideHeader === true)).toBe(true);
		expect(styleHeadings()).toEqual(["gallery.styles.title"]);
	});

	it("Given 缓存为空且尚未绘制完, When GalleryView 第一次提交, Then 风格墙已在但项目扫描尚未开始", async () => {
		galleryCache.current = null;
		await mount();

		expect(host.textContent).toContain("gallery.hero.title");
		expect(host.textContent).toContain("gallery.styles.title");
		expect(host.textContent).toContain("style-grid-body");
		expect(loadGallery).not.toHaveBeenCalled();

		await paint();
		expect(loadGallery).toHaveBeenCalled();
		expect(loadGallery.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ skipCovers: true }));
	});
});

describe("全部设计页可见完成", () => {
	it("Given 用户从首页点查看全部且列表 chunk 未到, When 主区提交, Then 仍有分区标题而不是空白", async () => {
		galleryCache.current = { cards: CARDS, workspacePath: "/w" };
		await mount();

		const more = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("gallery.section.more"),
		);
		expect(more).toBeDefined();
		await act(async () => {
			more?.click();
		});

		expect(host.textContent).toContain("gallery.section.mine");
		expect(headingTexts()).toContain("gallery.section.mine");
		expect(host.querySelector("[data-card]")).toBeNull();
	});
});
