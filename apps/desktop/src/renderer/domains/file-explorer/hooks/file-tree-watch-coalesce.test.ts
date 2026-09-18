import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectoryReloadScheduler } from "./file-tree-watch-coalesce";

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
