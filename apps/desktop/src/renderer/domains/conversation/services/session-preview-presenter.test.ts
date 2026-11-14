import type { HistoryEntry } from "@astravia/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { presentSessionPreview } from "./session-preview-presenter";

function entry(text: string): HistoryEntry {
	return {
		type: "message",
		turnId: "turn-1",
		messageId: `m-${text}`,
		entryId: `e-${text}`,
		message: { role: "user", content: text, timestamp: 1 },
		timestamp: new Date(1).toISOString(),
	} as unknown as HistoryEntry;
}

/**
 * 两段式首屏的判定：片段先出、完整历史并发读、片段无用时不要多画一遍、被取代后不再提交。
 * 其中「并发读」是硬要求——片段提交里含一次等绘制的屏障，串行会让完整历史被它拖后。
 */
describe("会话首屏的两段式编排", () => {
	it("尾部片段先提交，完整历史随后覆盖", async () => {
		const order: string[] = [];
		await presentSessionPreview({
			readTail: async () => {
				order.push("readTail");
				return { history: [entry("tail")], truncated: true };
			},
			readFull: async () => {
				order.push("readFull");
				return { history: [entry("tail"), entry("full")] };
			},
			onTail: (history) => {
				order.push(`tail:${history.length}`);
			},
			onFull: (history) => {
				order.push(`full:${history.length}`);
			},
		});

		// readFull 在 tail 提交之前就发起（并发），提交顺序仍是 tail → full。
		expect(order).toEqual(["readTail", "readFull", "tail:1", "full:2"]);
	});

	it("片段提交慢（例如等绘制屏障）不会推迟完整历史的读取", async () => {
		const readFull = vi.fn(async () => ({ history: [entry("full")] }));
		let releaseTail: (() => void) | undefined;
		const tailCommitted = new Promise<void>((resolve) => {
			releaseTail = resolve;
		});

		const run = presentSessionPreview({
			readTail: async () => ({ history: [entry("tail")], truncated: true }),
			readFull,
			onTail: async () => {
				await tailCommitted;
			},
			onFull: vi.fn(),
		});

		// 片段还卡在提交里，完整读取必须已经开始。
		await Promise.resolve();
		await Promise.resolve();
		expect(readFull).toHaveBeenCalledTimes(1);

		releaseTail?.();
		await run;
	});

	it("片段就是整份文件时不重复渲染（truncated=false）", async () => {
		const onTail = vi.fn();
		await presentSessionPreview({
			readTail: async () => ({ history: [entry("a")], truncated: false }),
			readFull: async () => ({ history: [entry("a")] }),
			onTail,
			onFull: vi.fn(),
		});

		expect(onTail).not.toHaveBeenCalled();
	});

	it("读尾部失败时退化成原路径：只提交完整历史", async () => {
		const onFull = vi.fn();
		await presentSessionPreview({
			readTail: async () => Promise.reject(new Error("broken tail")),
			readFull: async () => ({ history: [entry("a")] }),
			onTail: vi.fn(),
			onFull,
		});

		expect(onFull).toHaveBeenCalledWith([entry("a")]);
	});

	it("打开已被取代时，片段和完整历史都不提交", async () => {
		const onTail = vi.fn();
		const onFull = vi.fn();
		let current = true;
		await presentSessionPreview({
			readTail: async () => {
				current = false; // 读的过程中用户切走了
				return { history: [entry("tail")], truncated: true };
			},
			readFull: async () => ({ history: [entry("tail")] }),
			onTail,
			onFull,
			isCurrent: () => current,
		});

		expect(onTail).not.toHaveBeenCalled();
		expect(onFull).not.toHaveBeenCalled();
	});
});
