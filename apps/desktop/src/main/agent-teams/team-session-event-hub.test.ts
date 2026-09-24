import type { TeamSessionDocument } from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type { RuntimeHost, RuntimeSessionExecutionObservation, SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { DesktopTeamSessionStreamEvent } from "../../preload/api-types/team-conversation-display.js";
import { TeamSessionEventHub } from "./team-session-event-hub.js";

describe("TeamSessionEventHub active replay", () => {
	it("publishes the actual model request boundary and defers sibling warmup until a response block completes", () => {
		let sessionListener: ((event: SessionEvent) => void) | undefined;
		const onFirstResponseBlockCompleted = vi.fn();
		const runtime = {
			subscribe: vi.fn((_sessionId: string, listener: (event: SessionEvent) => void) => {
				sessionListener = listener;
				return () => undefined;
			}),
		} as unknown as RuntimeHost;
		const session = {
			id: "team-session",
			memberRuntime: { leader: { sessionId: "leader-runtime", sessionPath: "C:/sessions/leader.jsonl" } },
		} as unknown as TeamSessionDocument;
		const hub = new TeamSessionEventHub({
			runtime: () => runtime,
			getSession: () => session,
			observe: () => undefined,
			onFirstResponseBlockCompleted,
		});
		const events: DesktopTeamSessionStreamEvent[] = [];
		hub.addSubscriber(session.id, (event) => events.push(event));
		hub.beginTurn("leader-runtime", {
			teamSessionId: session.id,
			memberId: "leader",
			requestId: "public-request",
			turnId: "runtime-turn",
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

		sessionListener?.({
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "leader-runtime",
			eventId: "model-request",
			timestamp: 42,
			source: "agent",
			sequence: 1,
			type: "model.request.started",
			turnId: "runtime-turn",
			modelCallIndex: 0,
		} as SessionEvent);

		expect(events).toContainEqual({
			type: "desktop.team-model-request-started",
			conversationId: "team-session",
			memberId: "leader",
			runtimeSessionId: "leader-runtime",
			requestId: "public-request",
			timestamp: 42,
		});
		expect(onFirstResponseBlockCompleted).not.toHaveBeenCalled();

		const emptyPartial = createAssistantMessage({ api: "openai-responses", provider: "test", model: "fixture" });
		sessionListener?.({
			schemaVersion: 1,
			channel: "assistant",
			sessionId: "leader-runtime",
			eventId: "response-start",
			timestamp: 43,
			source: "agent",
			sequence: 2,
			turnId: "runtime-turn",
			modelCallIndex: 0,
			type: "start",
			partial: emptyPartial,
		} as SessionEvent);
		expect(onFirstResponseBlockCompleted).not.toHaveBeenCalled();

		const textPartial = { ...emptyPartial, content: [{ type: "text" as const, text: "Ready" }] };
		for (const [sequence, delta] of ["Re", "ady"].entries()) {
			sessionListener?.({
				schemaVersion: 1,
				channel: "assistant",
				sessionId: "leader-runtime",
				eventId: `response-text-${sequence}`,
				timestamp: 44 + sequence,
				source: "agent",
				sequence: 3 + sequence,
				turnId: "runtime-turn",
				modelCallIndex: 0,
				type: "text_delta",
				contentIndex: 0,
				delta,
				partial: textPartial,
			} as SessionEvent);
		}
		expect(onFirstResponseBlockCompleted).not.toHaveBeenCalled();
		sessionListener?.({
			schemaVersion: 1,
			channel: "assistant",
			sessionId: "leader-runtime",
			eventId: "response-text-end",
			timestamp: 46,
			source: "agent",
			sequence: 5,
			turnId: "runtime-turn",
			modelCallIndex: 0,
			type: "text_end",
			contentIndex: 0,
			content: "Ready",
			partial: textPartial,
		} as SessionEvent);
		expect(onFirstResponseBlockCompleted).toHaveBeenCalledTimes(1);
		expect(onFirstResponseBlockCompleted).toHaveBeenCalledWith("team-session", "leader");
	});

	it("publishes one running transition for the first member turn and one idle transition after the last", () => {
		const runningChanges: Array<{ teamSessionId: string; running: boolean }> = [];
		const hub = new TeamSessionEventHub({
			runtime: () => ({}) as RuntimeHost,
			getSession: () => undefined,
			observe: () => undefined,
			onRunningChanged: (teamSessionId, running) => runningChanges.push({ teamSessionId, running }),
		});
		const activeTurn = (memberId: string, messageId: string) => ({
			teamSessionId: "team-session",
			memberId,
			requestId: "request",
			turnId: `${memberId}-turn`,
			messageId,
			author: { kind: "agent" as const, id: memberId },
			workItemId: `${memberId}-work-item`,
			attemptId: `${memberId}-attempt`,
			startedAt: 1,
			seq: 0,
			text: "",
			rawAssistantStream: false,
			toolExecutionEvents: [],
		});

		hub.beginTurn("leader-runtime", activeTurn("leader", "leader-result"));
		hub.beginTurn("executor-runtime", activeTurn("executor", "executor-result"));
		expect(hub.runningSessionIds()).toEqual(["team-session"]);
		hub.endTurn("leader-runtime");
		expect(runningChanges).toEqual([{ teamSessionId: "team-session", running: true }]);
		hub.endTurn("executor-runtime");

		expect(hub.runningSessionIds()).toEqual([]);
		expect(runningChanges).toEqual([
			{ teamSessionId: "team-session", running: true },
			{ teamSessionId: "team-session", running: false },
		]);
	});

	it("releases deferred warmup when a compatibility stream publishes its final message", () => {
		let sessionListener: ((event: SessionEvent) => void) | undefined;
		const onFirstResponseBlockCompleted = vi.fn();
		const runtime = {
			subscribe: vi.fn((_sessionId: string, listener: (event: SessionEvent) => void) => {
				sessionListener = listener;
				return () => undefined;
			}),
		} as unknown as RuntimeHost;
		const session = {
			id: "team-session",
			memberRuntime: { leader: { sessionId: "leader-runtime", sessionPath: "C:/sessions/leader.jsonl" } },
		} as unknown as TeamSessionDocument;
		const hub = new TeamSessionEventHub({
			runtime: () => runtime,
			getSession: () => session,
			observe: () => undefined,
			onFirstResponseBlockCompleted,
		});
		hub.beginTurn("leader-runtime", {
			teamSessionId: session.id,
			memberId: "leader",
			requestId: "request",
			turnId: "runtime-turn",
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

		sessionListener?.({
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "leader-runtime",
			eventId: "message-final",
			timestamp: 2,
			source: "agent",
			type: "message.final",
			message: {
				...createAssistantMessage({ api: "openai-responses", provider: "test", model: "fixture" }),
				content: [{ type: "text", text: "Ready" }],
			},
		} as SessionEvent);

		expect(onFirstResponseBlockCompleted).toHaveBeenCalledOnce();
		expect(onFirstResponseBlockCompleted).toHaveBeenCalledWith("team-session", "leader");
	});

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
