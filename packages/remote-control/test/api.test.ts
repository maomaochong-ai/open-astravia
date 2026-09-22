import { describe, expect, it } from "vitest";
import {
	readMessageEvent,
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
