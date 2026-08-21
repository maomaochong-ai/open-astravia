import type { SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { DesktopConversationRemoteOperations } from "./desktop-conversation-remote-operations.js";

describe("DesktopConversationRemoteOperations", () => {
	it("creates an opaque remote session then translates a turn into protocol events", async () => {
		const session = {
			sessionId: "runtime-session-1",
			sessionPath: "C:/work/.vetta/sessions/1.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		let observedTimeout: number | null | undefined;
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [],
			openSession: async () => session,
			runTurn: async (options: { timeoutMs: number | null }) => {
				observedTimeout = options.timeoutMs;
				return {
					...session,
					status: "completed" as const,
					stopReason: "stop",
					assistantText: "Desktop answer",
					messageCount: 2,
				};
			},
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });
		const diagnostics = await operations.diagnostics();
		expect(diagnostics).toMatchObject({
			activeSessionCount: 0,
			cwd: "C:/work",
			osLabel: expect.any(String),
			cpu: expect.any(String),
			ram: expect.stringMatching(/(?:GB|MB)$/),
		});

		expect(await operations.createSession()).toEqual({ sessionId: "runtime-session-1" });
		const events = [];
		for await (const event of operations.prompt("runtime-session-1", "hello")) events.push(event);

		expect(events).toEqual([
			{ type: "state", payload: { state: "running" } },
			{ type: "delta", text: "Desktop answer" },
			{ type: "state", payload: { state: "completed", stopReason: "stop" } },
		]);
		expect(observedTimeout).toBeNull();
	});

	it("forwards runtime deltas and tool lifecycle events as they arrive", async () => {
		const session = {
			sessionId: "runtime-session-stream",
			sessionPath: "C:/work/.vetta/sessions/stream.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		let subscriber: ((event: SessionEvent) => void) | undefined;
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [],
			openSession: async () => session,
			subscribe: (_sessionId: string, handler: (event: SessionEvent) => void) => {
				subscriber = handler;
				return () => {
					subscriber = undefined;
				};
			},
			runTurn: async () => {
				subscriber?.({
					type: "message.delta",
					delta: "part",
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e1",
					timestamp: 1,
					source: "agent",
				});
				subscriber?.({
					type: "message.final",
					message: { role: "assistant", content: [{ type: "text", text: "part" }] },
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e-final-1",
					timestamp: 1,
					source: "agent",
				} as SessionEvent);
				subscriber?.({
					type: "message.final",
					message: { role: "assistant", content: [{ type: "text", text: "next answer" }] },
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e-final-2",
					timestamp: 2,
					source: "agent",
				} as SessionEvent);
				subscriber?.({
					type: "tool.start",
					toolCallId: "call-1",
					toolName: "read_file",
					args: { path: "README.md" },
					startedAt: 1,
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e2",
					timestamp: 2,
					source: "agent",
				});
				subscriber?.({
					type: "tool.phase",
					toolCallId: "call-1",
					toolName: "read_file",
					label: "读取文件内容",
					atMs: 24,
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e-phase",
					timestamp: 2,
					source: "agent",
				});
				subscriber?.({
					type: "retry.start",
					attempt: 1,
					maxAttempts: 2,
					delayMs: 100,
					errorMessage: "temporary",
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e3",
					timestamp: 3,
					source: "agent",
				});
				subscriber?.({
					type: "compaction.start",
					reason: "threshold",
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e4",
					timestamp: 4,
					source: "agent",
				});
				subscriber?.({
					type: "usage.update",
					input: 100,
					output: 25,
					cacheRead: 0,
					cacheWrite: 0,
					costTotal: 0,
					contextPercent: 12,
					contextWindow: 1000,
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e5",
					timestamp: 5,
					source: "agent",
				});
				return {
					...session,
					status: "completed" as const,
					stopReason: "stop",
					assistantText: "part",
					messageCount: 2,
				};
			},
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });
		await operations.createSession();
		const events = [];
		for await (const event of operations.prompt(session.sessionId, "hello")) events.push(event);
		expect(events).toEqual([
			{ type: "state", payload: { state: "running" } },
			{ type: "delta", text: "part" },
			{ type: "delta", text: "next answer" },
			{
				type: "tool",
				payload: { phase: "started", toolCallId: "call-1", toolName: "read_file", args: '{"path":"README.md"}' },
			},
			{
				type: "tool",
				payload: { phase: "phase", toolCallId: "call-1", toolName: "read_file", label: "读取文件内容" },
			},
			{ type: "state", payload: { state: "retrying", attempt: 1, maxAttempts: 2 } },
			{ type: "state", payload: { state: "compacting" } },
			{ type: "state", payload: { state: "usage", input: 100, output: 25, total: 125, contextPercent: 12 } },
			{ type: "state", payload: { state: "completed", stopReason: "stop" } },
		]);
	});
});
