/**
 * 画布与离屏截图窗口之间的 localStorage 同步。
 *
 * 复现的 bug：设计稿支持深浅色切换并写进 localStorage，用户在 frame 里切到深色后，
 * 画布上的位图仍是浅色，点进去（活体）是深色、点出来（位图）又是浅色。画布 iframe
 * 是跨站嵌入，存储被 Chromium 分区；离屏截图窗口是顶层页面，读的是另一个桶，永远是
 * 默认状态。修法是由画布把快照带进离屏窗口的地址，引擎启动时先写进存储。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyStorageSeed,
	parseStorageEntries,
	readStorageEntries,
	STORAGE_SEED_PARAM,
	watchLocalStorage,
} from "../engine/src/storage-sync";
import { captureFrameOffscreen, offscreenEngineUrl, setOffscreenStorageSeed } from "../src/canvas/offscreen-raster";
import { setPluginCtx } from "../src/plugin-context";

/**
 * 不直接用全局 localStorage：新版 Node 自带一个同名全局（没给 --localstorage-file 时
 * 是 undefined），会盖住 happy-dom 的。自己建一个 happy-dom 的 Storage 挂上去。
 */
const storage = new Storage();

beforeEach(() => {
	vi.stubGlobal("localStorage", storage);
	storage.clear();
	history.replaceState(null, "", "/");
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("引擎侧", () => {
	it("快照按键排序，同样的内容序列化结果一致", () => {
		storage.setItem("theme", "dark");
		storage.setItem("accent", "blue");
		expect(JSON.stringify(readStorageEntries(storage))).toBe('{"accent":"blue","theme":"dark"}');
	});

	it("只接受字符串到字符串的平面对象", () => {
		expect(parseStorageEntries({ theme: "dark" })).toEqual({ theme: "dark" });
		expect(parseStorageEntries({ theme: 1 })).toBeNull();
		expect(parseStorageEntries(["dark"])).toBeNull();
		expect(parseStorageEntries(null)).toBeNull();
	});

	it("地址带快照时整份替换存储，并把参数从地址上抹掉", () => {
		storage.setItem("stale", "x");
		const seed = encodeURIComponent(JSON.stringify({ theme: "dark" }));
		history.replaceState(null, "", `/?${STORAGE_SEED_PARAM}=${seed}&keep=1`);

		expect(applyStorageSeed(window)).toBe(true);
		expect(readStorageEntries(storage)).toEqual({ theme: "dark" });
		expect(`${location.pathname}${location.search}`).toBe("/?keep=1");
	});

	it("地址不带快照时不碰存储", () => {
		storage.setItem("theme", "light");
		expect(applyStorageSeed(window)).toBe(false);
		expect(storage.getItem("theme")).toBe("light");
	});

	it("挂上时报一次快照，之后的写入合并上报，并标出是否来自用户操作", () => {
		vi.useFakeTimers();
		const reports: Record<string, unknown>[] = [];
		const activation = { isActive: false };
		// happy-dom 没有 userActivation，直接挂一个可控的。
		Object.defineProperty(window.navigator, "userActivation", { value: activation, configurable: true });
		// 换一个没用过的实例，并且挂上监听前不碰它：happy-dom 的 Storage 首次取方法后
		// 会缓存，之前用过的实例看不到后打的原型补丁（真实浏览器没有这回事）。
		const local = new Storage();
		vi.stubGlobal("localStorage", local);
		try {
			watchLocalStorage((message) => reports.push(message));
			expect(reports).toEqual([{ type: "storage", entries: {}, user: false }]);

			// 页面自己写的：照报，但不算用户操作。
			local.setItem("visited", "home");
			vi.advanceTimersByTime(200);
			expect(reports[1]).toMatchObject({ user: false });

			// 点击切主题：同一批里的几次写入合成一条。
			activation.isActive = true;
			local.setItem("theme", "dark");
			local.removeItem("visited");
			activation.isActive = false;
			vi.advanceTimersByTime(200);
			expect(reports).toHaveLength(3);
			expect(reports[2]).toEqual({ type: "storage", entries: { theme: "dark" }, user: true });

			// 别的 Storage（sessionStorage）的写入不会混进快照。
			new Storage().setItem("x", "1");
			vi.advanceTimersByTime(200);
			expect(reports.at(-1)).toMatchObject({ entries: { theme: "dark" } });
		} finally {
			vi.useRealTimers();
			Reflect.deleteProperty(window.navigator, "userActivation");
		}
	});
});

describe("画布侧", () => {
	afterEach(() => {
		setPluginCtx(null as unknown as PluginContext);
	});

	it("快照变化时离屏地址跟着变，内容不变则地址不变（窗口继续复用）", () => {
		const port = 40001;
		expect(offscreenEngineUrl(port)).toBe(`http://127.0.0.1:${port}/`);

		expect(setOffscreenStorageSeed(port, { theme: "dark" })).toBe(true);
		const url = new URL(offscreenEngineUrl(port));
		expect(url.pathname).toBe("/");
		expect(JSON.parse(url.searchParams.get(STORAGE_SEED_PARAM) ?? "")).toEqual({ theme: "dark" });

		expect(setOffscreenStorageSeed(port, { theme: "dark" })).toBe(false);
		expect(setOffscreenStorageSeed(port, { theme: "light" })).toBe(true);
	});

	it("过大的快照不进地址，退回不同步", () => {
		const port = 40002;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			setOffscreenStorageSeed(port, { blob: "x".repeat(300 * 1024) });
			expect(offscreenEngineUrl(port)).toBe(`http://127.0.0.1:${port}/`);
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("离屏截图按画布那侧的状态加载引擎", async () => {
		const port = 40003;
		const urls: string[] = [];
		setPluginCtx({
			capture: {
				offscreen: (options: { url: string }) => {
					urls.push(options.url);
					return Promise.resolve({ dataUrl: "data:x", scaleFactor: 2 });
				},
				releaseOffscreen: () => Promise.resolve(),
			},
		} as unknown as PluginContext);
		setOffscreenStorageSeed(port, { theme: "dark" });

		await captureFrameOffscreen({ port, frameId: "home", width: 390, height: 844, quality: 0.9 });
		expect(new URL(urls[0]).searchParams.get(STORAGE_SEED_PARAM)).toBe('{"theme":"dark"}');
	});
});
