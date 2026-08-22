import type { ChatMessage } from "@shared/store/atoms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendTextDelta,
	finishAssistantTurn,
	getActiveAssistantTurnStartedAt,
	resetStreamState,
	restoreAssistantTurn,
	startAssistantTurn,
} from "./chat-service";

describe("assistant turn projection", () => {
	beforeEach(() => {
		resetStreamState();
		vi.useRealTimers();
	});

	it("agent_start immediately creates a stable empty assistant draft", () => {
		const startedAt = 1_700_000_000_000;
		const user: ChatMessage = { id: "user-1", role: "user", text: "hello", timestamp: startedAt - 20 };

		const started = startAssistantTurn([user], startedAt);
		const draft = started.at(-1);

		expect(draft).toMatchObject({
			role: "assistant",
			text: "",
			blocks: [],
			startedAt,
			timestamp: startedAt,
		});
		const withText = appendTextDelta(started, "first token");
		expect(withText).toHaveLength(2);
		expect(withText.at(-1)?.id).toBe(draft?.id);
		expect(withText.at(-1)?.text).toBe("first token");
	});

	it("restores an in-flight turn even when history has no assistant after the latest user", () => {
		const startedAt = 1_700_000_000_000;
		const messages: ChatMessage[] = [{ id: "user-1", role: "user", text: "slow request" }];

		const restored = restoreAssistantTurn(messages, startedAt);

		expect(restored).toHaveLength(2);
		expect(restored.at(-1)).toMatchObject({ role: "assistant", startedAt, text: "", blocks: [] });
		expect(getActiveAssistantTurnStartedAt(restored)).toBe(startedAt);
	});

	it("restores unresolved history tools as pending on the same assistant message", () => {
		const startedAt = 1_700_000_000_000;
		const assistant: ChatMessage = {
			id: "assistant-1",
			role: "assistant",
			text: "",
			blocks: [
				{
					type: "tool_call",
					toolCallId: "tool-1",
					toolName: "read_file",
					args: {},
					status: "success",
				},
			],
		};

		const restored = restoreAssistantTurn([{ id: "user-1", role: "user", text: "inspect" }, assistant], startedAt);

		expect(restored.at(-1)?.id).toBe("assistant-1");
		expect(restored.at(-1)?.startedAt).toBe(startedAt);
		expect(restored.at(-1)?.blocks?.[0]).toMatchObject({ type: "tool_call", status: "pending" });
	});

	it("computes completion from the message absolute start after stream state was reset", () => {
		const startedAt = 1_700_000_000_000;
		const endedAt = startedAt + 128_400;
		const started = startAssistantTurn([{ id: "user-1", role: "user", text: "work" }], startedAt);
		resetStreamState();

		const finished = finishAssistantTurn(started, endedAt);

		expect(finished.at(-1)).toMatchObject({
			startedAt,
			endedAt,
			durationSeconds: 128.4,
		});
	});

	it("keeps aborted then agent_end terminal events idempotent", () => {
		const startedAt = 1_700_000_000_000;
		const started = startAssistantTurn([{ id: "user-1", role: "user", text: "work" }], startedAt);
		const aborted = finishAssistantTurn(started, startedAt + 5_000);

		expect(getActiveAssistantTurnStartedAt(aborted)).toBeUndefined();
		expect(finishAssistantTurn(aborted, startedAt + 8_000)).toBe(aborted);
		expect(aborted.at(-1)?.durationSeconds).toBe(5);
	});
});
