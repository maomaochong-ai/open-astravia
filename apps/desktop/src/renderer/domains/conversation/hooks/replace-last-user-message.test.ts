// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceLastUserMessageWithRetry } from "./useSessionMessageSender";

afterEach(() => {
	// 桩是全局的 window：不还原会污染同一 worker 里后跑的套件。
	delete (window as unknown as { astravia?: unknown }).astravia;
});

function stubSession(replace: (id: string, entryId: string) => Promise<void>): void {
	(window as unknown as { astravia: unknown }).astravia = { session: { replaceLastUserMessage: replace } };
}

/**
 * 编辑重发时先 abort 再替换；abort 在 runtime 侧异步收尾，替换会被拒一次。
 * 那一次失败是时序问题，重试即可——不该变成用户眼前的「连接失败，会话中断」。
 */
describe("编辑重发的替换重试", () => {
	it("第一次被拒后重试成功，不抛错", async () => {
		const replace = vi.fn().mockRejectedValueOnce(new Error("runtime is stopping")).mockResolvedValueOnce(undefined);
		stubSession(replace);

		await expect(replaceLastUserMessageWithRetry("rt-1", "entry-1", [0, 0])).resolves.toBeUndefined();
		expect(replace).toHaveBeenCalledTimes(2);
	});

	it("一直失败才抛错，且抛出的是最后一次的真实原因", async () => {
		const replace = vi.fn().mockRejectedValue(new Error("会话文件被占用"));
		stubSession(replace);

		await expect(replaceLastUserMessageWithRetry("rt-1", "entry-1", [0, 0])).rejects.toThrow("会话文件被占用");
		expect(replace).toHaveBeenCalledTimes(2);
	});

	it("首次就成功时只调用一次，不做多余的等待", async () => {
		const replace = vi.fn().mockResolvedValue(undefined);
		stubSession(replace);

		await replaceLastUserMessageWithRetry("rt-1", "entry-1", [0, 250, 600]);
		expect(replace).toHaveBeenCalledTimes(1);
	});
});
