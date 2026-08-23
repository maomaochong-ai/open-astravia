import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 画廊进入时的风格库刷新策略（性能合同）：
 * - 挂载自动刷新走 TTL + ETag（不带 force），低配机首开不再固定多扛一次 300+KB 清单下载；
 * - 用户手动点「刷新」仍然强制拉最新（force: true）。
 */

// t 固定为稳定引用，对齐真实 plugin-sdk（useCallback 缓存）；不稳定的 t 会让依赖
// [t] 的 refresh 每次渲染换身份，把 mount effect 变成无限循环。
vi.mock("@astravia-org/plugin-sdk", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

const refreshDesignCatalog = vi.fn();
vi.mock("../src/design-systems/index", () => ({
	refreshDesignCatalog: (...args: unknown[]) => refreshDesignCatalog(...args),
	useCatalogState: () => ({ systems: [], status: "ready" }),
}));

const loadGallery = vi.fn(async () => ({ cards: [], workspacePath: "/tmp/designs" }));
vi.mock("../src/gallery/gallery-store", () => ({
	getCachedSnapshot: () => null,
	loadGallery: () => loadGallery(),
}));

// 工具栏现在挂在宿主页头上（ui.setWorkspaceViewHeader），测试扮演宿主：接住
// 插件推过来的节点，自己渲染出来，再按用户行为点它。
const hostHeader = vi.hoisted(() => ({ current: null as { left?: unknown; right?: unknown } | null }));
vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		ui: {
			setWorkspaceViewHeader: (_viewId: string, header: { left?: unknown; right?: unknown } | null) => {
				hostHeader.current = header;
			},
		},
	}),
	notify: vi.fn(),
}));

// 子视图与画廊数据无关，全部替换成最小替身，只保留刷新按钮所在的工具栏路径。
vi.mock("../src/gallery/DesignSystemGrid", () => ({ DesignSystemGrid: () => null }));
vi.mock("../src/gallery/AllProjectsView", () => ({ AllProjectsView: () => null }));
vi.mock("../src/gallery/GalleryCard", () => ({ GalleryCard: () => null }));
vi.mock("../src/gallery/CardContextMenu", () => ({ CardContextMenu: () => null }));
vi.mock("../src/gallery/CreateDesignDialog", () => ({ CreateDesignDialog: () => null }));
vi.mock("../src/gallery/DesignSystemDetailDialog", () => ({ DesignSystemDetailDialog: () => null }));
vi.mock("../src/canvas/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("../src/gallery/use-gallery-columns", () => ({ useGalleryColumns: () => 3 }));
vi.mock("../src/gallery/open-project", () => ({
	openProjectFromGallery: vi.fn(),
	startDesignProject: vi.fn(),
}));
vi.mock("../src/gallery/start-from-system", () => ({ startDesignFromSystem: vi.fn() }));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryView } from "../src/gallery/GalleryView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let headerHost: HTMLDivElement;
let headerRoot: Root;

beforeEach(() => {
	refreshDesignCatalog.mockClear();
	loadGallery.mockClear();
	hostHeader.current = null;
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
	act(() => root.unmount());
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
	// 宿主页头的那半边 UI：插件推什么就渲染什么。
	await act(async () => {
		headerRoot.render(
			<>
				{hostHeader.current?.left as React.ReactNode}
				{hostHeader.current?.right as React.ReactNode}
			</>,
		);
	});
}

describe("画廊风格库刷新策略", () => {
	it("挂载自动刷新不带 force（走 TTL + ETag）", async () => {
		await mountGallery();
		expect(loadGallery).toHaveBeenCalled();
		expect(refreshDesignCatalog).toHaveBeenCalled();
		for (const call of refreshDesignCatalog.mock.calls) {
			const options = call[2] as { force?: boolean } | undefined;
			expect(options?.force).not.toBe(true);
		}
	});

	it("手动点「刷新」强制拉最新（force: true）", async () => {
		await mountGallery();
		refreshDesignCatalog.mockClear();

		const button = document.body.querySelector<HTMLButtonElement>('[aria-label="gallery.action.refresh"]');
		expect(button).not.toBeNull();
		await act(async () => {
			button?.click();
		});

		const forced = refreshDesignCatalog.mock.calls.some(
			(call) => (call[2] as { force?: boolean } | undefined)?.force === true,
		);
		expect(forced).toBe(true);
	});
});
