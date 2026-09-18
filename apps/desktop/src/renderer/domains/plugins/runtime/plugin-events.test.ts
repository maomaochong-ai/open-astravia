import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 发送门（waitForPluginHostFirstReady）与加载周期门（waitForPluginHostReady）的合同：
 * - 冷启动首轮发送仍等插件工具注册完成（保持 af739f7a1 的语义）；
 * - 首次就绪之后，插件热重载不得再把发送挡住（last-known-good 注册仍有效）；
 * - 工作区路由等的是当前加载周期，语义不变。
 */

async function loadModule() {
	vi.resetModules();
	return import("./plugin-events.js");
}

async function settles(promise: Promise<unknown>, withinMs = 20): Promise<boolean> {
	const marker = Symbol("pending");
	const result = await Promise.race([
		promise.then(() => "settled" as const),
		new Promise<typeof marker>((resolve) => setTimeout(() => resolve(marker), withinMs)),
	]);
	return result !== marker;
}

describe("plugin-events 就绪门", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, "info").mockImplementation(() => {});
	});

	it("首次就绪前，首轮发送门保持等待；markPluginHostReady 后放行", async () => {
		const events = await loadModule();
		const wait = events.waitForPluginHostFirstReady(10_000);
		expect(await settles(wait)).toBe(false);
		events.markPluginHostReady();
		expect(await settles(wait)).toBe(true);
	});

	it("首次就绪后，再次进入加载周期也不再阻塞发送门", async () => {
		const events = await loadModule();
		events.markPluginHostLoading();
		events.markPluginHostReady();
		// 插件热重载：重新进入 loading。
		events.markPluginHostLoading();
		expect(await settles(events.waitForPluginHostFirstReady(10_000))).toBe(true);
	});

	it("加载周期门（waitForPluginHostReady）仍逐周期等待", async () => {
		const events = await loadModule();
		events.markPluginHostLoading();
		events.markPluginHostReady();
		events.markPluginHostLoading();
		const wait = events.waitForPluginHostReady(10_000);
		expect(await settles(wait)).toBe(false);
		events.markPluginHostReady();
		expect(await settles(wait)).toBe(true);
	});

	it("发送门超时兜底仍然有效（宿主一直不就绪也最多等 timeoutMs）", async () => {
		vi.useFakeTimers();
		try {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const events = await loadModule();
			events.markPluginHostLoading();
			let resolved = false;
			void events.waitForPluginHostFirstReady(5000).then(() => {
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(4999);
			expect(resolved).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			expect(resolved).toBe(true);
			expect(warn).toHaveBeenCalledWith('[plugin-agent] wait host first ready timed out {"timeoutMs":5000}');
		} finally {
			vi.useRealTimers();
		}
	});
});
