import type { AssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { createEmptyConversationDocument } from "../../src/conversation/index.js";
import { RuntimeContextUsageTracker } from "../../src/kernel/index.js";

describe("RuntimeContextUsageTracker", () => {
	it("uses the injected document estimator for initialization and document changes", () => {
		let estimate = 12;
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => estimate });
		const document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });

		tracker.initialize(document);
		expect(tracker.readUsage(100)).toEqual({ tokens: 12, contextWindow: 100, percent: 12 });
		estimate = 25;
		tracker.onDocumentChanged(document);
		expect(tracker.readUsage(100).tokens).toBe(25);
	});

	it("prefers completed provider usage and retains the privacy-safe composition report", async () => {
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => 0 });
		await tracker.observe(
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: assistantMessage(30),
				timestamp: 1,
			},
			new AbortController().signal,
		);
		expect(tracker.readUsage(100).tokens).toBe(30);

		const report = {
			version: 1 as const,
			callId: "call-1",
			snapshotId: "snapshot-1",
			phase: "completed" as const,
			createdAt: 2,
			model: { provider: "test", modelId: "model", contextWindow: 100 },
			estimate: { tokens: 20, knownTokens: 20, coverage: "complete" as const },
			providerReportedInputTokens: 42,
			sections: [],
		};
		tracker.publishContextComposition(report);
		expect(tracker.readUsage(100)).toEqual({ tokens: 42, contextWindow: 100, percent: 42, composition: report });
	});

	it("rejects invalid token counts at the boundary", () => {
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => -1 });
		expect(() =>
			tracker.initialize(createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 })),
		).toThrow("token count");
		expect(() => tracker.recordEstimatedTokens(Number.NaN)).toThrow("token count");
		expect(() => tracker.readUsage(-1)).toThrow("Context window");
	});
});

function assistantMessage(totalTokens: number): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "test",
		model: "model",
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}
