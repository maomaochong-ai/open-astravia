import { beforeEach, describe, expect, it, vi } from "vitest";

import { isQuitCleanupStarted, resetQuitCleanupForTest, runQuitCleanup, setQuitCleanup } from "./quit-cleanup";

describe("quit cleanup", () => {
	beforeEach(() => {
		resetQuitCleanupForTest();
	});

	it("runs the registered cleanup once even under concurrent callers", async () => {
		const cleanup = vi.fn(async () => {});
		setQuitCleanup(cleanup);

		await Promise.all([runQuitCleanup(), runQuitCleanup()]);
		await runQuitCleanup();

		expect(cleanup).toHaveBeenCalledOnce();
	});

	// before-quit 靠这个标记决定是否直通：更新安装路径已经自行清理过，
	// 此时 before-quit 再 preventDefault + app.exit(0) 会抢在 Squirrel.Mac
	// 拉起 ShipIt 之前打死进程，表现为「退出了但版本没变」。
	it("reports started as soon as cleanup begins, not only after it finishes", async () => {
		let release = () => {};
		setQuitCleanup(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		expect(isQuitCleanupStarted()).toBe(false);

		const pending = runQuitCleanup();
		expect(isQuitCleanupStarted()).toBe(true);

		release();
		await pending;
		expect(isQuitCleanupStarted()).toBe(true);
	});

	it("is a no-op when nothing registered a cleanup", async () => {
		await expect(runQuitCleanup()).resolves.toBeUndefined();
		expect(isQuitCleanupStarted()).toBe(true);
	});
});
