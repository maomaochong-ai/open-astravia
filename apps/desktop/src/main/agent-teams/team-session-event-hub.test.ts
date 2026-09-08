import type { TeamSessionDocument } from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type { RuntimeHost, RuntimeSessionExecutionObservation, SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { DesktopTeamSessionStreamEvent } from "../../preload/api-types/team-conversation-display.js";
import { TeamSessionEventHub } from "./team-session-event-hub.js";

describe("TeamSessionEventHub active replay", () => {
	it("reconstructs the active message and every tool lifecycle event after resubscription", () => {
		let sessionListener: ((event: SessionEvent) => void) | undefined;
		let executionListener: ((event: RuntimeSessionExecutionObservation) => void) | undefined;
		const runtime = {
			subscribe: vi.fn((_sessionId: string, listener: (event: SessionEvent) => void) => {
				sessionListener = listener;
				return () => undefined;
			}),
			subscribeExecutionObservations: vi.fn(
				(_sessionId: string, listener: (event: RuntimeSessionExecutionObservation) => void) => {
					executionListener = listener;
					return () => undefined;
				},
			),
		} as unknown as RuntimeHost;
		const session = {
			id: "team-session",
			teamId: "team",
			memberRuntime: {
				leader: { sessionId: "leader-runtime", sessionPath: "C:/sessions/leader.jsonl" },
			},
		} as unknown as TeamSessionDocument;
		const hub = new TeamSessionEventHub({
			runtime: () => runtime,
			getSession: () => session,
			observe: () => undefined,
		});
		const live: DesktopTeamSessionStreamEvent[] = [];
		hub.addSubscriber(session.id, (event) => live.push(event));
		hub.beginTurn("leader-runtime", {
			teamSessionId: session.id,
			memberId: "leader",
			requestId: "request",
			turnId: "leader-turn",
			messageId: "leader-result",
			author: { kind: "agent", id: "leader" },
			workItemId: "work-item",
			attemptId: "attempt",
			startedAt: 1,
			seq: 0,
			text: "",
			rawAssistantStream: false,
			toolExecutionEvents: [],
		});
		hub.attach(session);

		const result = { content: [{ type: "text" as const, text: "done" }] };
		const observations: RuntimeSessionExecutionObservation[] = [
			{
				turnId: "leader-turn",
				timestamp: 2,
				event: {
					type: "tool.execution.start",
					toolCallId: "read-index",
					toolName: "read",
					args: { path: "index.html" },
					startedAt: 2,
				},
			},
			{
				turnId: "leader-turn",
				timestamp: 3,
				event: {
					type: "tool.execution.update",
					toolCallId: "read-index",
					toolName: "read",
					args: { path: "index.html" },
					partialResult: result,
				},
			},
			{
				turnId: "leader-turn",
				timestamp: 4,
				event: {
					type: "tool.execution.phase",
					toolCallId: "read-index",
					toolName: "read",
					label: "reading",
					atMs: 2,
				},
			},
			{
				turnId: "leader-turn",
				timestamp: 5,
				event: {
					type: "tool.execution.end",
					toolCallId: "read-index",
					toolName: "read",
					result,
					isError: false,
					startedAt: 2,
					durationMs: 3,
					phases: [{ label: "reading", atMs: 2 }],
				},
			},
		];
		executionListener?.(observations[0]!);
		const partial = {
			...createAssistantMessage({ api: "openai-responses", provider: "test", model: "fixture" }, { timestamp: 2 }),
			content: [{ type: "toolCall" as const, id: "read-index", name: "read", arguments: { path: "index.html" } }],
		};
		sessionListener?.({
			schemaVersion: 1,
			channel: "assistant",
			sessionId: "leader-runtime",
			eventId: "assistant-tool",
			timestamp: 2,
			source: "agent",
			sequence: 1,
			turnId: "leader-turn",
			modelCallIndex: 0,
			type: "toolcall_start",
			contentIndex: 0,
			partial,
		} as SessionEvent);
		for (const observation of observations.slice(1)) executionListener?.(observation);

		const toolEvents = live.filter((event) => event.type === "desktop.team-tool-execution");
		expect(toolEvents.map((event) => event.event.type)).toEqual(["start", "update", "phase", "end"]);
		expect(hub.activeStreamEvents(session.id).map((event) => event.type)).toEqual([
			"conversation.agent-message-event",
			"desktop.team-tool-execution",
			"desktop.team-tool-execution",
			"desktop.team-tool-execution",
			"desktop.team-tool-execution",
		]);
		expect(hub.activeStreamEvents(session.id).map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
	});
});
