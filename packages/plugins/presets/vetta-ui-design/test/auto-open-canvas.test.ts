import type { PluginStorageApi } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { claimCanvasAutoOpen, resetCanvasAutoOpenCache } from "../src/vetd/auto-open";
import { isPureDesignProject, pickVetdFiles } from "../src/vetd/discover";

function ref(relPath: string): { name: string; path: string; relPath: string } {
	const name = relPath.split("/").pop() ?? relPath;
	return { name, path: `/proj/${relPath}`, relPath };
}

describe("isPureDesignProject", () => {
	it("认纯设计目录", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("app.vetd")])).toBe(true);
	});

	it("放过根目录的说明文件", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("README.md"), ref("AGENTS.md")])).toBe(true);
	});

	it("有代码就不算纯设计项目", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("src/main.ts")])).toBe(false);
	});

	it("嵌套目录里的同名说明文件不豁免", () => {
		expect(isPureDesignProject([ref("landing.vetd"), ref("docs/readme.md")])).toBe(false);
	});

	it("没有设计稿就不是设计项目", () => {
		expect(isPureDesignProject([ref("README.md")])).toBe(false);
		expect(isPureDesignProject([])).toBe(false);
	});

	it("sidecar 里的 .vetd 不算数", () => {
		expect(isPureDesignProject([ref("landing.vetd.d/nested.vetd")])).toBe(false);
	});
});

describe("pickVetdFiles", () => {
	it("只取工作态设计稿并排序", () => {
		expect(pickVetdFiles([ref("b.vetd"), ref("a.vetd"), ref("a.vetd.d/inner.vetd"), ref("x.ts")])).toEqual([
			"/proj/a.vetd",
			"/proj/b.vetd",
		]);
	});
});

function fakeStorage(initial: Record<string, unknown> = {}): PluginStorageApi {
	const store = new Map<string, unknown>(Object.entries(initial));
	return {
		readJson: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
		writeJson: async (key: string, value: unknown) => {
			store.set(key, value);
		},
		list: async () => [...store.keys()],
		readFile: async () => null,
		writeFile: async () => {},
		putBlob: async () => ({ id: "", url: "", mimeType: "" }),
		putBlobFromFile: async () => ({ id: "", url: "", mimeType: "" }),
		readBlob: async () => null,
		getBlobRef: async () => null,
	};
}

describe("claimCanvasAutoOpen", () => {
	beforeEach(() => {
		resetCanvasAutoOpenCache();
	});

	it("同一项目只认领一次", async () => {
		const storage = fakeStorage();
		expect(await claimCanvasAutoOpen(storage, "/proj")).toBe(true);
		expect(await claimCanvasAutoOpen(storage, "/proj")).toBe(false);
	});

	it("重启后读到持久记录仍不再自动打开", async () => {
		const storage = fakeStorage();
		expect(await claimCanvasAutoOpen(storage, "/proj")).toBe(true);
		resetCanvasAutoOpenCache();
		expect(await claimCanvasAutoOpen(storage, "/proj")).toBe(false);
	});

	it("不同项目各自认领", async () => {
		const storage = fakeStorage();
		expect(await claimCanvasAutoOpen(storage, "/a")).toBe(true);
		expect(await claimCanvasAutoOpen(storage, "/b")).toBe(true);
	});

	it("storage 报错时保守不打开", async () => {
		const storage = { ...fakeStorage(), readJson: async () => Promise.reject(new Error("boom")) } as PluginStorageApi;
		expect(await claimCanvasAutoOpen(storage, "/proj")).toBe(false);
	});
});
