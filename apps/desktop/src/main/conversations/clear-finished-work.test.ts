import { describe, expect, it, vi } from "vitest";
import { clearFinishedWork } from "./clear-finished-work";

/**
 * 面板上的「清除已结束 (N)」里的 N 是后台命令与子代理之和。
 * 清除必须覆盖这两类，否则清完 bash 行、子代理行还在，用户看到的就是点击没反应。
 */
describe("清除已结束的后台工作", () => {
	it("后台命令与子代理都会被清掉", async () => {
		// 用调用顺序区分两类：这两个 token 都是不透明对象，按引用比较容易写错。
		const results = [2, 1];
		let call = 0;
		const invokeSessionExtension = vi.fn(async () => results[call++] ?? 0);
		const result = await clearFinishedWork({ invokeSessionExtension } as never, "rt-1");

		expect(result).toEqual({ tasks: 2, subagents: 1 });
		// 两类各调一次，且都带同一个 sessionId。
		expect(invokeSessionExtension).toHaveBeenCalledTimes(2);
		expect(invokeSessionExtension.mock.calls[1]?.[0]).toBe("rt-1");
	});

	it("某一类扩展没注册时，另一类照样清", async () => {
		let call = 0;
		const invokeSessionExtension = vi.fn(async () => {
			call += 1;
			// 第二次调用 = 子代理那一类，模拟扩展未注册。
			if (call === 2) throw new Error("extension unavailable");
			return 3;
		});
		const result = await clearFinishedWork({ invokeSessionExtension } as never, "rt-1");

		expect(result).toEqual({ tasks: 3, subagents: 0 });
	});

	it("扩展返回非数字时按 0 计，不把 undefined 传到调用方", async () => {
		const invokeSessionExtension = vi.fn(async () => undefined);
		await expect(clearFinishedWork({ invokeSessionExtension } as never, "rt-1")).resolves.toEqual({
			tasks: 0,
			subagents: 0,
		});
	});
});
