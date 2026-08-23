import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 页头接管契约。首页的工具栏长在 Hero 里，页头只收掉宿主标题（留作窗口拖拽区）；
 * 「全部设计」列表页没有 Hero，工具栏才回到页头。两种状态都不该出现「应用名 +
 * 插件顶栏」两条叠加的栏。
 */

vi.mock("@astravia-org/plugin-sdk", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

const setWorkspaceViewHeader = vi.hoisted(() => vi.fn());
vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ ui: { setWorkspaceViewHeader } }),
	notify: vi.fn(),
}));

vi.mock("../src/design-systems/index", () => ({
	refreshDesignCatalog: vi.fn(),
	useCatalogState: () => ({ systems: [], status: "ready" }),
}));

function project(name: string) {
	const design = { vetdPath: `/w/${name}/${name}.vetd`, name, modifiedAt: 0 };
	return { cwd: `/w/${name}`, name, designs: [design], cover: design, modifiedAt: 0 };
}
// 四张卡 + 单列宫格（下方 mock）⇒ 首页只铺 3 张，「查看全部」入口出现。
const CARDS = [project("alpha"), project("beta"), project("gamma"), project("delta")];
vi.mock("../src/gallery/gallery-store", () => ({
	getCachedSnapshot: () => ({ cards: CARDS, workspacePath: "/w" }),
	loadGallery: async () => ({ cards: CARDS, workspacePath: "/w" }),
}));

vi.mock("../src/gallery/DesignSystemGrid", () => ({ DesignSystemGrid: () => null }));
vi.mock("../src/gallery/AllProjectsView", () => ({ AllProjectsView: () => null }));
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
vi.mock("../src/gallery/open-project", () => ({ openProjectFromGallery: vi.fn(), startDesignProject: vi.fn() }));
vi.mock("../src/gallery/start-from-system", () => ({ startDesignFromSystem: vi.fn() }));

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryView } from "../src/gallery/GalleryView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface CapturedHeader {
	hideTitle?: boolean;
	immersive?: boolean;
	left?: ReactNode;
	right?: ReactNode;
}

let host: HTMLDivElement;
let root: Root;
let headerHost: HTMLDivElement;
let headerRoot: Root;

function lastHeader(): CapturedHeader | null {
	const calls = setWorkspaceViewHeader.mock.calls;
	return (calls[calls.length - 1]?.[1] ?? null) as CapturedHeader | null;
}

/** 扮演宿主：把插件最新推过来的页头节点渲染出来。 */
async function renderHostHeader(): Promise<void> {
	const header = lastHeader();
	await act(async () => {
		headerRoot.render(
			<>
				{header?.left}
				{header?.right}
			</>,
		);
	});
}

beforeEach(() => {
	setWorkspaceViewHeader.mockClear();
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	headerHost = document.createElement("div");
	document.body.appendChild(headerHost);
	headerRoot = createRoot(headerHost);
});

afterEach(() => {
	act(() => headerRoot.unmount());
	headerHost.remove();
	host.remove();
	document.body.innerHTML = "";
});

async function mountGallery(): Promise<void> {
	await act(async () => {
		root.render(<GalleryView />);
	});
	await act(async () => {
		await Promise.resolve();
	});
	await renderHostHeader();
}

describe("画廊与宿主页头", () => {
	it("首页声明沉浸式页头（浮在画廊之上），不往页头塞工具栏", async () => {
		await mountGallery();

		const header = lastHeader();
		expect(header?.hideTitle).toBe(true);
		expect(header?.immersive).toBe(true);
		expect(header?.left).toBeUndefined();
		expect(header?.right).toBeUndefined();
		act(() => root.unmount());
	});

	it("首页的搜索框长在 Hero 里，并驱动画廊过滤", async () => {
		await mountGallery();
		expect(host.querySelectorAll("[data-card]")).toHaveLength(3);

		const input = host.querySelector<HTMLInputElement>('input[aria-label="gallery.search"]');
		expect(input).not.toBeNull();
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			setter?.call(input, "alpha");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});

		expect(host.querySelectorAll("[data-card]")).toHaveLength(1);
		expect(host.querySelector("[data-card]")?.getAttribute("data-card")).toBe("alpha");
		act(() => root.unmount());
	});

	it("进「全部设计」后工具栏回到页头", async () => {
		await mountGallery();

		const more = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("gallery.section.more"),
		);
		expect(more).toBeDefined();
		await act(async () => {
			more?.click();
		});
		await renderHostHeader();

		const header = lastHeader();
		expect(header?.hideTitle).toBe(true);
		// 列表页有自己的工具栏行，页头必须回到常规堆叠，否则工具栏会压在内容上。
		expect(header?.immersive).not.toBe(true);
		expect(header?.left).toBeTruthy();
		expect(header?.right).toBeTruthy();
		expect(headerHost.querySelector('input[aria-label="gallery.search"]')).not.toBeNull();
		act(() => root.unmount());
	});

	it("离开画廊时把页头还给宿主", async () => {
		await mountGallery();

		act(() => root.unmount());

		expect(setWorkspaceViewHeader).toHaveBeenLastCalledWith("gallery", null);
	});
});
