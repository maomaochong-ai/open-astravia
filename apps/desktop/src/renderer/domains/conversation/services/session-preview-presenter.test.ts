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
 * 两段式首屏的三个判定：片段先出、片段无用时不要多画一遍、被取代后不再提交。
 * 任何一条错了，这个优化要么白做，要么把已切换的会话又写回旧内容。
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

		expect(order).toEqual(["readTail", "tail:1", "readFull", "full:2"]);
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
