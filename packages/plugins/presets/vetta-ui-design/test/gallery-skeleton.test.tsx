// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「我的设计」首次加载：没有缓存可先画时，扫描返回前铺骨架卡，
 * 而不是先闪一句「0 个项目 / 没有匹配的设计」；数据到了骨架原位换成真卡。
 */

vi.mock("@vetta-org/plugin-sdk", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

vi.mock("../src/design-systems/index", () => ({
	refreshDesignCatalog: vi.fn(),
	useCatalogState: () => ({ systems: [], status: "ready" }),
}));

const design = { vetdPath: "/w/alpha/alpha.vetd", name: "alpha", modifiedAt: 0 };
const CARD = { cwd: "/w/alpha", name: "alpha", designs: [design], cover: design, modifiedAt: 0 };
const pending = vi.hoisted(() => ({ resolve: null as ((value: unknown) => void) | null }));
vi.mock("../src/gallery/gallery-store", () => ({
	getCachedSnapshot: () => null,
	isGalleryAbortError: () => false,
	loadGallery: () =>
		new Promise((resolve) => {
			pending.resolve = resolve;
		}),
}));

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ ui: { setWorkspaceViewHeader: vi.fn() } }),
	notify: vi.fn(),
}));

vi.mock("../src/gallery/DesignSystemGrid", () => ({ DesignSystemGrid: () => null }));
vi.mock("../src/gallery/AllProjectsView", () => ({ AllProjectsView: () => null }));
vi.mock("../src/gallery/GalleryHero", () => ({ GalleryHero: () => null }));
vi.mock("../src/gallery/GalleryCard", () => ({
	GalleryCard: ({ card }: { card: { name: string } }) => <div data-card={card.name} />,
}));
vi.mock("../src/gallery/CardContextMenu", () => ({ CardContextMenu: () => null }));
vi.mock("../src/gallery/CreateDesignDialog", () => ({ CreateDesignDialog: () => null }));
vi.mock("../src/gallery/DesignSystemDetailDialog", () => ({ DesignSystemDetailDialog: () => null }));
vi.mock("../src/canvas/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("../src/gallery/use-gallery-columns", () => ({ useGalleryColumns: () => ({ ref: () => {}, columns: 3 }) }));
vi.mock("../src/gallery/open-project", () => ({ openProjectFromGallery: vi.fn(), startDesignProject: vi.fn() }));
vi.mock("../src/gallery/start-from-system", () => ({ startDesignFromSystem: vi.fn() }));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryView } from "../src/gallery/GalleryView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	pending.resolve = null;
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

describe("画廊首次加载骨架", () => {
	it("扫描返回前铺一行骨架，不显示计数与无匹配提示", async () => {
		await act(async () => {
			root.render(<GalleryView />);
		});
		const grid = host.querySelector('[aria-label="gallery.loading"]');
		expect(grid?.getAttribute("aria-busy")).toBe("true");
		expect(grid?.children).toHaveLength(3);
		expect(host.textContent).not.toContain("gallery.count");
		expect(host.textContent).not.toContain("gallery.search.noMatch");
	});

	it("扫描返回后骨架换成真卡", async () => {
		await act(async () => {
			root.render(<GalleryView />);
		});
		await act(async () => {
			pending.resolve?.({ cards: [CARD], workspacePath: "/w" });
		});
		expect(host.querySelector('[aria-label="gallery.loading"]')).toBeNull();
		expect(host.querySelector('[data-card="alpha"]')).not.toBeNull();
		expect(host.textContent).toContain("gallery.count");
	});
});
