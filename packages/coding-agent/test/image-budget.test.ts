import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent, TextContent } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { applyImageBudget, estimateModelMessageRequestBytes } from "../src/model-context/image-budget.js";

const OMITTED = "[earlier image omitted to conserve memory]";

function img(id: string): ImageContent {
	return { type: "image", data: id, mimeType: "image/png" };
}

function text(t: string): TextContent {
	return { type: "text", text: t };
}

function user(...content: (TextContent | ImageContent)[]): AgentMessage {
	return { role: "user", content } as unknown as AgentMessage;
}

function toolResult(...content: (TextContent | ImageContent)[]): AgentMessage {
	return { role: "toolResult", content, toolCallId: "tc", toolName: "read" } as unknown as AgentMessage;
}

function assistant(): AgentMessage {
	return { role: "assistant", content: [text("ok")] } as unknown as AgentMessage;
}

function imageDataIds(msg: AgentMessage): string[] {
	const content = (msg as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];
	return content.filter((c): c is ImageContent => c.type === "image").map((c) => c.data);
}

function omittedCount(messages: AgentMessage[]): number {
	let n = 0;
	for (const msg of messages) {
		const content = (msg as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const c of content) {
			if (c.type === "text" && c.text === OMITTED) n++;
		}
	}
	return n;
}

describe("applyImageBudget", () => {
	it("keeps any number of seen and unseen images while the request remains below the byte watermark", () => {
		const messages = [
			toolResult(img("p1")),
			toolResult(img("p2")),
			toolResult(img("p3")),
			toolResult(img("p4")),
			toolResult(img("p5")),
			toolResult(img("p6")),
			assistant(),
			user(text("read another page"), img("p7")),
		];

		const result = applyImageBudget(messages);

		expect(result).toBe(messages);
		expect(omittedCount(result)).toBe(0);
		expect(result.flatMap(imageDataIds)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
	});

	it("keeps all images when there is no assistant message yet", () => {
		const messages = [user(img("a"), text("hi")), toolResult(img("b")), toolResult(img("c"))];

		const result = applyImageBudget(messages);

		expect(omittedCount(result)).toBe(0);
		expect(result.flatMap(imageDataIds)).toEqual(["a", "b", "c"]);
	});

	it("does not mutate the original messages", () => {
		const messages = [toolResult(img("p1")), toolResult(img("p2")), toolResult(img("p3")), assistant()];
		const snapshot = JSON.stringify(messages);

		applyImageBudget(messages, {
			highWatermarkBytes: estimateModelMessageRequestBytes(messages) - 1,
			lowWatermarkBytes: 1,
		});

		expect(JSON.stringify(messages)).toBe(snapshot);
	});

	it("returns the original array untouched when nothing exceeds the byte watermark", () => {
		const messages = [toolResult(img("p1")), assistant()];
		expect(applyImageBudget(messages)).toBe(messages);
	});

	it("drops oldest seen images according to serialized request watermarks", () => {
		const messages = [
			toolResult(img("a".repeat(100))),
			toolResult(img("b".repeat(100))),
			toolResult(img("c".repeat(100))),
			assistant(),
			toolResult(img("new".repeat(4))),
		];
		const afterTwoOmissions = [
			toolResult(text(OMITTED)),
			toolResult(text(OMITTED)),
			toolResult(img("c".repeat(100))),
			assistant(),
			toolResult(img("new".repeat(4))),
		];
		const requestBytes = estimateModelMessageRequestBytes(messages);

		const result = applyImageBudget(messages, {
			highWatermarkBytes: requestBytes - 1,
			lowWatermarkBytes: estimateModelMessageRequestBytes(afterTwoOmissions),
		});

		expect(result.flatMap(imageDataIds)).toEqual(["c".repeat(100), "new".repeat(4)]);
		expect(omittedCount(result)).toBe(2);
		expect(imageDataIds(messages[0])).toEqual(["a".repeat(100)]);
	});

	it("keeps unseen images even when they alone remain above the low watermark", () => {
		const messages = [toolResult(img("old".repeat(50))), assistant(), toolResult(img("new".repeat(20)))];
		const unseenOnly = [toolResult(text(OMITTED)), assistant(), toolResult(img("new".repeat(20)))];
		const requestBytes = estimateModelMessageRequestBytes(messages);

		const result = applyImageBudget(messages, {
			highWatermarkBytes: requestBytes - 1,
			lowWatermarkBytes: estimateModelMessageRequestBytes(unseenOnly) - 1,
		});

		expect(result.flatMap(imageDataIds)).toEqual(["new".repeat(20)]);
		expect(omittedCount(result)).toBe(1);
	});

	it("applies byte watermarks without a separate image count cap", () => {
		const messages = [toolResult(img("old".repeat(10))), assistant()];
		const requestBytes = estimateModelMessageRequestBytes(messages);

		const result = applyImageBudget(messages, {
			highWatermarkBytes: requestBytes - 1,
			lowWatermarkBytes: 1,
		});

		expect(result.flatMap(imageDataIds)).toEqual([]);
		expect(omittedCount(result)).toBe(1);
	});
});
