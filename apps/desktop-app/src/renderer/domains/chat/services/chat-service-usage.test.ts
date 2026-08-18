import type { AssistantMessage, Usage } from "@vetta/ai";
import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { ensureDraft, finalizeMessage, fullHistoryToChat, historyToChat, resetStreamState } from "./chat-service";

describe("chat message usage projection", () => {
	it("keeps every model-call usage when history assistant messages merge into one turn", () => {
		const first = usage({ input: 20, cacheRead: 70, cacheWrite: 10, cacheUsageReporting: "read-write" });
		const second = usage({ input: 50, cacheRead: 50, cacheUsageReporting: "read-only" });

		const messages = historyToChat([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: [{ type: "text", text: "working" }], usage: first },
			{ role: "assistant", content: [{ type: "text", text: "done" }], usage: second },
		]);

		expect(messages).toHaveLength(2);
		expect(messages[1]?.usages).toEqual([first, second]);
	});

	it("projects persisted full history and live final messages with the same usage shape", () => {
		const first = usage({ input: 20, cacheRead: 70, cacheWrite: 10, cacheUsageReporting: "read-write" });
		const second = usage({ input: 50, cacheRead: 50, cacheUsageReporting: "read-only" });
		const entries: HistoryEntry[] = [
			{ type: "message", entryId: "user-1", message: { role: "user", content: "hello", timestamp: 1 } },
			{ type: "message", entryId: "assistant-1", message: assistant("working", first) },
			{ type: "message", entryId: "assistant-2", message: assistant("done", second) },
		];

		expect(fullHistoryToChat(entries)[1]?.usages).toEqual([first, second]);

		resetStreamState();
		const [draft] = ensureDraft([]);
		const afterFirst = finalizeMessage(draft, [{ type: "text", text: "working" }], first);
		const afterSecond = finalizeMessage(afterFirst, [{ type: "text", text: "done" }], second);
		expect(afterSecond[0]?.usages).toEqual([first, second]);
		resetStreamState();
	});
});

function assistant(text: string, messageUsage: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: messageUsage,
		stopReason: "stop",
		timestamp: 2,
	};
}

function usage(overrides: Partial<Usage>): Usage {
	const input = overrides.input ?? 0;
	const output = overrides.output ?? 0;
	const cacheRead = overrides.cacheRead ?? 0;
	const cacheWrite = overrides.cacheWrite ?? 0;
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: overrides.totalTokens ?? input + output + cacheRead + cacheWrite,
		cacheUsageReporting: overrides.cacheUsageReporting,
		cost: overrides.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
