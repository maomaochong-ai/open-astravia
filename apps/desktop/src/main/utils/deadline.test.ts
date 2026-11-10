import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleWithin } from "./deadline";

describe("settleWithin", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("在 deadline 内结算时返回 true", async () => {
		const work = Promise.resolve("done");
		await expect(settleWithin(work, 1000)).resolves.toBe(true);
	});

	it("迟迟不结算时到点就放弃，不把调用方一起拖住", async () => {
		// 这正是断网后「停止生成」进来的样子：远端从不回话，按钮就永远停在停止中。
		const never = new Promise<void>(() => {});
		const pending = settleWithin(never, 1000);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(pending).resolves.toBe(false);
	});

	it("被拒绝也算已结算，不当成超时", async () => {
		const failing = Promise.reject(new Error("remote gone"));
		await expect(settleWithin(failing, 1000)).resolves.toBe(true);
	});

	it("结算后清掉计时器，不会留下悬空定时器", async () => {
		await settleWithin(Promise.resolve(1), 1000);
		expect(vi.getTimerCount()).toBe(0);
	});
});
