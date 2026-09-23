import { describe, expect, it } from "vitest";
import {
	REMOTE_MAX_UPLOAD_BYTES,
	readMessageEvent,
	readModelOptions,
	readQuestionRequest,
	readSessionState,
	readSessionSummaries,
	readToolEvent,
	readTranscriptEntries,
} from "../src/index.js";

describe("remote api payload readers", () => {
	it("keeps well-formed session summaries and drops malformed ones", () => {
		expect(
			readSessionSummaries({
				sessions: [
					{ id: "a", projectCwd: "/p", projectName: "P", title: "T", updatedAt: 5, status: "running", live: true },
					{ id: "b" },
					"junk",
				],
			}),
		).toEqual([
			{
				id: "a",
				projectCwd: "/p",
				projectName: "P",
				title: "T",
				preview: undefined,
				updatedAt: 5,
				status: "running",
				live: true,
			},
		]);
		expect(readSessionSummaries(undefined)).toEqual([]);
	});

	it("normalizes unknown statuses to idle and parses nested question requests", () => {
		const state = readSessionState({
			status: "weird",
			pendingQuestion: {
				requestId: "q1",
				questions: [
					{ question: "Deploy?", header: "Deploy", options: [{ label: "Yes" }, { nope: 1 }], multiSelect: false },
				],
			},
		});
		expect(state.status).toBe("idle");
		expect(state.pendingQuestion).toEqual({
			requestId: "q1",
			questions: [
				{ question: "Deploy?", header: "Deploy", options: [{ label: "Yes", description: "" }], multiSelect: false },
			],
		});
		expect(readQuestionRequest({ requestId: "q" })).toBeUndefined();
	});

	it("reads the model and thinking level a session runs with", () => {
		const state = readSessionState({
			status: "idle",
			model: "Claude Fable 5.1",
			modelKey: "anthropic/claude-fable-5-1",
			thinkingLevel: "high",
		});
		expect(state).toMatchObject({ modelKey: "anthropic/claude-fable-5-1", thinkingLevel: "high" });
		expect(readSessionState({ status: "idle" }).modelKey).toBeUndefined();
	});

	it("keeps model options with a key and their thinking levels", () => {
		expect(
			readModelOptions({
				models: [
					{
						key: "anthropic/claude-fable-5-1",
						name: "Claude Fable 5.1",
						provider: "anthropic",
						thinkingLevels: ["off", "low", 3, "high"],
						defaultThinkingLevel: "high",
						supportsImage: true,
					},
					{ key: "local/llama" },
					{ name: "no key" },
				],
			}),
		).toEqual([
			{
				key: "anthropic/claude-fable-5-1",
				name: "Claude Fable 5.1",
				provider: "anthropic",
				thinkingLevels: ["off", "low", "high"],
				defaultThinkingLevel: "high",
				supportsImage: true,
			},
			{
				key: "local/llama",
				name: "local/llama",
				provider: "local",
				thinkingLevels: [],
				defaultThinkingLevel: undefined,
				supportsImage: false,
			},
		]);
		expect(readModelOptions(undefined)).toEqual([]);
	});

	it("caps one upload well inside a sealed frame", () => {
		// base64 grows by 4/3 and the frame is sealed JSON; ~1.05 MB of plaintext fits the relay.
		expect(Math.ceil(REMOTE_MAX_UPLOAD_BYTES / 3) * 4).toBeLessThan(1_000_000);
	});

	it("reads message, tool and transcript payloads", () => {
		expect(readMessageEvent({ kind: "assistant_delta", text: "hi" })).toEqual({
			kind: "assistant_delta",
			text: "hi",
		});
		expect(readMessageEvent({ kind: "nope" })).toBeUndefined();
		expect(readToolEvent({ toolCallId: "t", toolName: "read", phase: "started", args: "{}" })).toMatchObject({
			toolName: "read",
			phase: "started",
		});
		expect(
			readTranscriptEntries({
				entries: [
					{ kind: "user", id: "1", text: "hello" },
					{ kind: "assistant", id: "2", text: "hey", toolCalls: [{ toolCallId: "t", toolName: "read" }, {}] },
					{ kind: "unknown", id: "3" },
				],
			}),
		).toEqual([
			{ kind: "user", id: "1", text: "hello", at: undefined },
			{
				kind: "assistant",
				id: "2",
				text: "hey",
				thinking: undefined,
				toolCalls: [
					{
						toolCallId: "t",
						toolName: "read",
						args: undefined,
						result: undefined,
						isError: false,
						durationMs: undefined,
					},
				],
				at: undefined,
				error: undefined,
			},
		]);
	});
});
