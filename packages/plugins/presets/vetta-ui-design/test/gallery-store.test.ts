import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 画廊扫描的离开合同：切走必须能中止封面合成，短时间内再进来用缓存而不是再扫一遍。
 * 首访 skipCovers 不得 compose；TTL 内随后一次完整 load 才补封面且不重列项目。
 */

const listProjects = vi.fn();
const loadCover = vi.fn(async (): Promise<string | null> => null);
const composeCover = vi.fn(async () => "data:image/jpeg;fake");

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		official: {
			projects: { list: () => listProjects() },
			sessions: { listRunningCwds: async () => [] },
		},
		fs: {
			readDir: async (dir: string) => [
				{ name: "alpha.vetd", path: `${dir}/alpha.vetd`, isDirectory: true, size: 0, modifiedAt: 1 },
			],
			stat: async () => ({ size: 1, modifiedAt: 1, createdAt: 0 }),
			readFile: async (path: string) =>
				path.endsWith("theme.css")
					? { content: ":root { --color-primary: #111; }" }
					: {
							content: JSON.stringify({
								frames: [{ id: "hero", x: 0, y: 0, width: 10, height: 10 }],
							}),
						},
		},
	}),
}));

vi.mock("../src/canvas/cover-compose", () => ({
	composeCover: (...args: unknown[]) => composeCover(...args),
}));

vi.mock("../src/canvas/raster-cache", () => ({
	loadCover: (...args: unknown[]) => loadCover(...args),
	saveCover: async () => undefined,
}));

import {
	GALLERY_RESCAN_TTL_MS,
	getCachedSnapshot,
	isGalleryCacheFresh,
	isGalleryCoverCacheComplete,
	loadGallery,
	resetGalleryStore,
	shouldRescanGallery,
} from "../src/gallery/gallery-store";

function projectList() {
	return {
		workspacePath: "/w",
		projects: [{ path: "/w/alpha", name: "alpha" }],
		archivedProjects: [],
	};
}

beforeEach(() => {
	resetGalleryStore();
	listProjects.mockReset();
	composeCover.mockClear();
	loadCover.mockReset();
	loadCover.mockImplementation(async () => null);
	listProjects.mockImplementation(async () => projectList());
});

afterEach(() => {
	resetGalleryStore();
});

describe("shouldRescanGallery", () => {
	it("手动刷新或超过 TTL 才重扫，缓存新鲜时跳过", () => {
		expect(shouldRescanGallery(1_000, 0, false)).toBe(true);
		expect(shouldRescanGallery(1_000, 900, false)).toBe(false);
		expect(shouldRescanGallery(1_000, 900, true)).toBe(true);
		expect(shouldRescanGallery(900 + GALLERY_RESCAN_TTL_MS, 900, false)).toBe(true);
	});
});

describe("isGalleryCacheFresh", () => {
	it("没有缓存时不算新鲜，TTL 内的命中才算", async () => {
		expect(isGalleryCacheFresh(1_000)).toBe(false);
		await loadGallery({ now: 1_000 });
		expect(isGalleryCacheFresh(2_000)).toBe(true);
		expect(isGalleryCacheFresh(1_000 + GALLERY_RESCAN_TTL_MS)).toBe(false);
	});
});

describe("loadGallery", () => {
	it("TTL 内再次进入直接复用缓存，不重扫项目、不重合成封面", async () => {
		const first = await loadGallery({ now: 1_000 });
		expect(first.cards).toHaveLength(1);
		expect(listProjects).toHaveBeenCalledTimes(1);
		expect(composeCover).toHaveBeenCalledTimes(1);
		expect(isGalleryCoverCacheComplete()).toBe(true);

		listProjects.mockClear();
		composeCover.mockClear();
		const second = await loadGallery({ now: 2_000 });
		expect(second).toBe(first);
		expect(listProjects).not.toHaveBeenCalled();
		expect(composeCover).not.toHaveBeenCalled();
	});

	it("离开页面中止扫描时不写入缓存，也不把半成品当成结果", async () => {
		let resolveList: ((value: ReturnType<typeof projectList>) => void) | undefined;
		listProjects.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveList = resolve;
				}),
		);
		const controller = new AbortController();
		const pending = loadGallery({ signal: controller.signal, now: 1_000 });
		controller.abort();
		resolveList?.(projectList());
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(getCachedSnapshot()).toBeNull();
		expect(composeCover).not.toHaveBeenCalled();
		expect(isGalleryCoverCacheComplete()).toBe(false);
	});

	it("skipCovers 只读缓存 jpeg，不调用 composeCover", async () => {
		loadCover.mockResolvedValue("data:image/jpeg;cached");
		const snapshot = await loadGallery({ skipCovers: true, now: 1_000 });
		expect(snapshot.cards[0]?.coverDataUrl).toBe("data:image/jpeg;cached");
		expect(composeCover).not.toHaveBeenCalled();
		expect(isGalleryCoverCacheComplete()).toBe(false);
		expect(isGalleryCacheFresh(2_000)).toBe(true);
	});

	it("skipCovers 快照在 TTL 内仍会补封面，且不重列项目", async () => {
		const first = await loadGallery({ skipCovers: true, now: 1_000 });
		expect(first.cards[0]?.coverDataUrl).toBeNull();
		expect(listProjects).toHaveBeenCalledTimes(1);
		expect(composeCover).not.toHaveBeenCalled();
		expect(isGalleryCoverCacheComplete()).toBe(false);

		listProjects.mockClear();
		const filled = await loadGallery({ now: 2_000 });
		expect(listProjects).not.toHaveBeenCalled();
		expect(composeCover).toHaveBeenCalledTimes(1);
		expect(filled.cards[0]?.coverDataUrl).toBe("data:image/jpeg;fake");
		expect(isGalleryCoverCacheComplete()).toBe(true);
		expect(getCachedSnapshot()).toBe(filled);
	});

	it("TTL 内再次 skipCovers 复用列表，仍然不合成封面", async () => {
		await loadGallery({ skipCovers: true, now: 1_000 });
		listProjects.mockClear();
		composeCover.mockClear();
		const second = await loadGallery({ skipCovers: true, now: 2_000 });
		expect(second.cards).toHaveLength(1);
		expect(listProjects).not.toHaveBeenCalled();
		expect(composeCover).not.toHaveBeenCalled();
		expect(isGalleryCoverCacheComplete()).toBe(false);
	});

	it("中止补封面时不把封面标成已齐，也不调用 composeCover", async () => {
		await loadGallery({ skipCovers: true, now: 1_000 });
		let resolveCached: ((value: string | null) => void) | undefined;
		loadCover.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCached = resolve;
				}),
		);
		const controller = new AbortController();
		const pending = loadGallery({ signal: controller.signal, now: 2_000 });
		controller.abort();
		resolveCached?.(null);
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(composeCover).not.toHaveBeenCalled();
		expect(isGalleryCoverCacheComplete()).toBe(false);
		expect(getCachedSnapshot()?.cards[0]?.coverDataUrl).toBeNull();
	});
});
