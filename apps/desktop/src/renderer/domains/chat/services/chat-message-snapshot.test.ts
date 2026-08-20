import type { ChatMessage } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { shareChatMessageSnapshot } from "./chat-message-snapshot";

function message(id: string, text: string): ChatMessage {
	return { id, role: "assistant", text, blocks: [{ id: `${id}-text`, type: "text", text }] };
}

describe("shareChatMessageSnapshot", () => {
	it("完整等价时保留预览数组与所有消息引用", () => {
		const preview = [message("a", "first"), message("b", "second")];
		const canonical = [message("a", "first"), message("b", "second")];

		const result = shareChatMessageSnapshot(preview, canonical);

		expect(result.messages).toBe(preview);
		expect(result.reusedCount).toBe(2);
	});

	it("只替换 Runtime 中真正变化的消息", () => {
		const preview = [message("a", "first"), message("b", "preview")];
		const canonical = [message("a", "first"), message("b", "canonical"), message("c", "new")];

		const result = shareChatMessageSnapshot(preview, canonical);

		expect(result.messages).not.toBe(preview);
		expect(result.messages[0]).toBe(preview[0]);
		expect(result.messages[1]).toBe(canonical[1]);
		expect(result.messages[2]).toBe(canonical[2]);
		expect(result.reusedCount).toBe(1);
	});

	it("顺序改变时按稳定消息 id 复用，而不错误沿用旧位置", () => {
		const first = message("a", "first");
		const second = message("b", "second");

		const result = shareChatMessageSnapshot([first, second], [message("b", "second"), message("a", "first")]);

		expect(result.messages).toEqual([second, first]);
		expect(result.reusedCount).toBe(2);
	});
});
