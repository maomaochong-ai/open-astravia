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
	it("keeps ALL unseen images from a fresh batch regardless of budget", () => {
		// 6 images read in one turn (after the last assistant message), budget 2.
		const messages = [
			user(text("read these pages")),
			assistant(),
			toolResult(img("p1")),
			toolResult(img("p2")),
			toolResult(img("p3")),
			toolResult(img("p4")),
			toolResult(img("p5")),
			toolResult(img("p6")),
		];

		const result = applyImageBudget(messages, 2);

		// All 6 survive — the upcoming call is the model's first viewing.
		expect(omittedCount(result)).toBe(0);
		const kept = result.flatMap(imageDataIds);
		expect(kept).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
	});

	it("applies the budget to already-seen images (before the last assistant message)", () => {
		// Images read, then an assistant message follows → now "seen".
		const messages = [
			toolResult(img("p1")),
			toolResult(img("p2")),
			toolResult(img("p3")),
			assistant(), // last assistant: everything before it is seen
		];

		const result = applyImageBudget(messages, 2);

		// Keep newest 2 seen images, omit the oldest.
		expect(omittedCount(result)).toBe(1);
		const kept = result.flatMap(imageDataIds);
		expect(kept).toEqual(["p2", "p3"]);
	});

	it("keeps unseen images AND budgets seen images in the same stream", () => {
		const messages = [
			toolResult(img("old1")),
			toolResult(img("old2")),
			toolResult(img("old3")),
			assistant(), // seen | unseen boundary
			toolResult(img("new1")),
			toolResult(img("new2")),
		];

		const result = applyImageBudget(messages, 1);

		// Unseen new1/new2 always kept; among seen old*, keep newest 1 (old3).
		const kept = result.flatMap(imageDataIds);
		expect(kept).toEqual(["old3", "new1", "new2"]);
		expect(omittedCount(result)).toBe(2); // old1, old2
	});

	it("keeps all images when there is no assistant message yet", () => {
		const messages = [user(img("a"), text("hi")), toolResult(img("b")), toolResult(img("c"))];

		const result = applyImageBudget(messages, 1);

		expect(omittedCount(result)).toBe(0);
		expect(result.flatMap(imageDataIds)).toEqual(["a", "b", "c"]);
	});

	it("budget <= 0 disables the filter and returns the original array", () => {
		const messages = [toolResult(img("a"), img("b")), assistant()];
		expect(applyImageBudget(messages, 0)).toBe(messages);
		expect(applyImageBudget(messages, -1)).toBe(messages);
		expect(applyImageBudget(messages, Number.NaN)).toBe(messages);
	});

	it("does not mutate the original messages", () => {
		const messages = [toolResult(img("p1")), toolResult(img("p2")), toolResult(img("p3")), assistant()];
		const snapshot = JSON.stringify(messages);

		applyImageBudget(messages, 1);

		expect(JSON.stringify(messages)).toBe(snapshot);
	});

	it("returns the original array untouched when nothing exceeds budget", () => {
		const messages = [toolResult(img("p1")), assistant()];
		expect(applyImageBudget(messages, 5)).toBe(messages);
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
			maxRecentImages: 10,
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
			maxRecentImages: 10,
			highWatermarkBytes: requestBytes - 1,
			lowWatermarkBytes: estimateModelMessageRequestBytes(unseenOnly) - 1,
		});

		expect(result.flatMap(imageDataIds)).toEqual(["new".repeat(20)]);
		expect(omittedCount(result)).toBe(1);
	});

	it("allows byte watermarks without enabling the legacy image count cap", () => {
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
