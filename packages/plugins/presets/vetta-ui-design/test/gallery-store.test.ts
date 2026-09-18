import { beforeEach, describe, expect, it, vi } from "vitest";

const listProjects = vi.fn();
const readDir = vi.fn();
const loadCover = vi.fn(async (): Promise<string | null> => "data:image/jpeg;cached");
const composeCover = vi.fn(async () => "data:image/jpeg;composed");

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		official: {
			projects: { list: () => listProjects() },
			sessions: { listRunningCwds: async () => [] },
		},
		fs: {
			readDir: (path: string) => readDir(path),
			stat: async () => ({ size: 1, modifiedAt: 1, createdAt: 0 }),
			readFile: async () => ({ content: ":root { --color-primary: #111; }" }),
		},
	}),
}));
vi.mock("../src/canvas/raster-cache", () => ({
	loadCover: (...args: unknown[]) => loadCover(...args),
	saveCover: async () => undefined,
}));
vi.mock("../src/canvas/cover-compose", () => ({
	composeCover: (...args: unknown[]) => composeCover(...args),
}));

function project(path: string) {
	return { path, name: path.split("/").at(-1) };
}

function entries(path: string) {
	return [{ name: "main.vetd", path: `${path}/main.vetd`, isDirectory: true, size: 0, modifiedAt: 1 }];
}

beforeEach(() => {
	vi.resetModules();
	listProjects.mockReset().mockImplementation(async () => ({
		workspacePath: "/work",
		projects: [project("/work/a"), project("/work/b"), project("/work/c")],
	}));
	readDir.mockReset().mockImplementation(async (path: string) => entries(path));
	loadCover.mockReset().mockResolvedValue("data:image/jpeg;cached");
	composeCover.mockReset().mockResolvedValue("data:image/jpeg;composed");
});

describe("gallery background work", () => {
	it("keeps the same ordered cards while processing at most two covers at once", async () => {
		let release!: () => void;
		let startedTwo!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const firstTwo = new Promise<void>((resolve) => { startedTwo = resolve; });
		let active = 0;
		let peak = 0;
		loadCover.mockImplementation(async () => {
			active++;
			peak = Math.max(peak, active);
			if (active === 2) startedTwo();
			await gate;
			active--;
			return "data:image/jpeg;cached";
		});
		const { loadGallery } = await import("../src/gallery/gallery-store");
		const pending = loadGallery();
		await firstTwo;
		expect(readDir).toHaveBeenCalledTimes(3);
		expect(loadCover).toHaveBeenCalledTimes(2);
		expect(peak).toBe(2);
		release();
		const first = await pending;
		expect(first.cards.map((card) => card.name)).toEqual(["a", "b", "c"]);
		expect(peak).toBe(2);
		expect(composeCover).not.toHaveBeenCalled();

		listProjects.mockResolvedValue({ workspacePath: "/work", projects: [project("/work/new")] });
		const second = await loadGallery();
		expect(second.cards.map((card) => card.name)).toEqual(["new"]);
		expect(listProjects).toHaveBeenCalledTimes(2);
	});

	it("leaving during a scan keeps the previous complete snapshot and starts no more projects", async () => {
		const { getCachedSnapshot, loadGallery } = await import("../src/gallery/gallery-store");
		const first = await loadGallery();
		let resolveList!: (value: unknown) => void;
		listProjects.mockImplementation(() => new Promise((resolve) => { resolveList = resolve; }));
		readDir.mockClear();
		const controller = new AbortController();
		const pending = loadGallery(controller.signal);
		controller.abort();
		resolveList({ workspacePath: "/work", projects: [project("/work/new")] });
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(readDir).not.toHaveBeenCalled();
		expect(getCachedSnapshot()).toBe(first);
	});
});
