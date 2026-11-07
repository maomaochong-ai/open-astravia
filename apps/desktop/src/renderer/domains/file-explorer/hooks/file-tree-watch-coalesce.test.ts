import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectoryReloadScheduler, watchPathKey } from "./file-tree-watch-coalesce";

afterEach(() => {
	vi.useRealTimers();
});

describe("createDirectoryReloadScheduler", () => {
	it("reloads a watched directory once after a burst of change events", () => {
		vi.useFakeTimers();
		const reload = vi.fn();
		const scheduler = createDirectoryReloadScheduler(reload, 100);

		scheduler.notify("/repo/src");
		scheduler.notify("/repo/src");
		scheduler.notify("/repo/src");
		expect(reload).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(reload).toHaveBeenCalledWith("/repo/src");
		scheduler.dispose();
	});

	it("keeps independent directories on separate timers", () => {
		vi.useFakeTimers();
		const reload = vi.fn();
		const scheduler = createDirectoryReloadScheduler(reload, 100);

		scheduler.notify("/repo/a");
		vi.advanceTimersByTime(50);
		scheduler.notify("/repo/b");
		vi.advanceTimersByTime(50);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(reload).toHaveBeenCalledWith("/repo/a");

		vi.advanceTimersByTime(50);
		expect(reload).toHaveBeenCalledTimes(2);
		expect(reload).toHaveBeenNthCalledWith(2, "/repo/b");
		scheduler.dispose();
	});

	it("drops pending reloads on dispose so an unmounted tree does not refresh", () => {
		vi.useFakeTimers();
		const reload = vi.fn();
		const scheduler = createDirectoryReloadScheduler(reload, 100);
		scheduler.notify("/repo");
		scheduler.dispose();
		vi.advanceTimersByTime(100);
		expect(reload).not.toHaveBeenCalled();
	});
});

describe("watchPathKey", () => {
	it("把同一个目录的不同写法归到同一个键", () => {
		const key = watchPathKey("C:\\Work\\App");
		expect(watchPathKey("C:/Work/App")).toBe(key);
		expect(watchPathKey("c:\\work\\app")).toBe(key);
		expect(watchPathKey("C:/Work/App/")).toBe(key);
	});

	it("大小写不同的 POSIX 路径是两个目录", () => {
		expect(watchPathKey("/repo/App")).not.toBe(watchPathKey("/repo/app"));
		expect(watchPathKey("/repo/app/")).toBe(watchPathKey("/repo/app"));
	});

	it("根目录不会因为去尾分隔符变成空键", () => {
		expect(watchPathKey("/")).toBe("/");
		expect(watchPathKey("////")).toBe("/");
	});
});
