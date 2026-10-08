import type { AssistantMessage, AssistantMessageEvent } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../contracts.js";
import type { RuntimeHostQueueSidecar } from "./runtime-host-queue-sidecar.js";
import { RuntimeHostSessionEventRelay } from "./runtime-host-session-event-relay.js";
import { lifecycleSessionEvent, mapRuntimeSessionObservationEvent } from "./session-events.js";
import type { RuntimeSessionEventStream } from "./session-ports.js";
import type { RuntimeHostSessionRecord } from "./types.js";

function createEventStream(): RuntimeSessionEventStream & { emit(event: SessionEvent): void } {
	const handlers = new Set<(event: SessionEvent) => void>();
	return {
		subscribe(handler) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		emit(event) {
			for (const handler of handlers) handler(event);
		},
	};
}

function assistantEvent(event: AssistantMessageEvent): SessionEvent {
	return mapRuntimeSessionObservationEvent(
		"session-1",
		{ type: "assistant.event", modelCallIndex: 0, event, source: "agent" },
		undefined,
		{ turnId: "turn-1" },
	);
}

describe("RuntimeHostSessionEventRelay", () => {
	it("replays raw assistant events in their original interleaved order with stable sequences", () => {
		const stream = createEventStream();
		const handle = {
			lifecycle: { sessionId: "session-1", sessionPath: "C:/sessions/session-1.jsonl" },
			stateReader: { readState: () => ({ activeToolNames: [] }) },
			eventStream: stream,
		} as unknown as RuntimeHostSessionRecord;
		const relay = new RuntimeHostSessionEventRelay({
			queueSidecar: { persist: () => undefined } as unknown as RuntimeHostQueueSidecar,
			synchronizeSessionIdentity: () => undefined,
			reportFailure: () => undefined,
		});
		relay.attach("session-key", handle, stream);

		const partial = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "r" },
				{ type: "text", text: "a" },
			],
		} as unknown as AssistantMessage;
		const protocolEvents: AssistantMessageEvent[] = [
			{ type: "thinking_start", contentIndex: 0, partial },
			{ type: "thinking_delta", contentIndex: 0, delta: "r", partial },
			{ type: "text_start", contentIndex: 1, partial },
			{ type: "text_delta", contentIndex: 1, delta: "a", partial },
			{ type: "thinking_delta", contentIndex: 0, delta: "b", partial },
		];

		const live: SessionEvent[] = [];
		const unsubscribeLive = relay.subscribe("session-key", handle, (event) => live.push(event));
		stream.emit(lifecycleSessionEvent("session-1", "agent_start", 100));
		stream.emit(
			mapRuntimeSessionObservationEvent(
				"session-1",
				{
					type: "model.request.started",
					modelCallIndex: 0,
					source: "agent",
					timestamp: 200,
				},
				undefined,
				{ turnId: "turn-1" },
			),
		);
		const waitingReplay: SessionEvent[] = [];
		const unsubscribeWaiting = relay.subscribe("session-key", handle, (event) => waitingReplay.push(event));
		expect(waitingReplay.filter((event) => event.type === "model.request.started")).toMatchObject([
			{ timestamp: 200, turnId: "turn-1", modelCallIndex: 0 },
		]);
		unsubscribeWaiting();
		for (const event of protocolEvents) stream.emit(assistantEvent(event));

		const replayed: SessionEvent[] = [];
		const unsubscribeReplay = relay.subscribe("session-key", handle, (event) => replayed.push(event));
		const liveAssistant = live.filter((event) => event.channel === "assistant");
		const replayedAssistant = replayed.filter((event) => event.channel === "assistant");

		expect(replayedAssistant.map((event) => event.type)).toEqual(protocolEvents.map((event) => event.type));
		expect(replayedAssistant.map((event) => event.sequence)).toEqual(liveAssistant.map((event) => event.sequence));
		for (let index = 0; index < replayedAssistant.length; index += 1) {
			expect(replayedAssistant[index]).toMatchObject(protocolEvents[index] ?? {});
		}
		expect(replayed.filter((event) => event.type === "model.request.started")).toEqual(
			live.filter((event) => event.type === "model.request.started"),
		);
		stream.emit(lifecycleSessionEvent("session-1", "agent_end", 500));
		const endedReplay: SessionEvent[] = [];
		const unsubscribeEnded = relay.subscribe("session-key", handle, (event) => endedReplay.push(event));
		expect(endedReplay.some((event) => event.type === "model.request.started")).toBe(false);
		unsubscribeEnded();

		unsubscribeReplay();
		unsubscribeLive();
		relay.release("session-key", handle.lifecycle.sessionPath, handle.lifecycle.sessionId);
	});

	it("exposes the running Turn identity and replays its tool executions to late subscribers", () => {
		const stream = createEventStream();
		const handle = {
			lifecycle: { sessionId: "session-1", sessionPath: "C:/sessions/session-1.jsonl" },
			stateReader: { readState: () => ({ activeToolNames: [] }) },
			eventStream: stream,
		} as unknown as RuntimeHostSessionRecord;
		const relay = new RuntimeHostSessionEventRelay({
			queueSidecar: { persist: () => undefined } as unknown as RuntimeHostQueueSidecar,
			synchronizeSessionIdentity: () => undefined,
			reportFailure: () => undefined,
		});
		relay.attach("session-key", handle, stream);
		const turnEvent = (type: "conversation.turn.started" | "conversation.turn.completed"): SessionEvent =>
			({
				schemaVersion: 1,
				channel: "runtime",
				sessionId: "session-1",
				eventId: `${type}-event`,
				timestamp: 100,
				source: "runtime-core",
				type,
				turnId: "turn-1",
				...(type === "conversation.turn.completed" ? { stopReason: "stop" } : {}),
			}) as SessionEvent;

		stream.emit(turnEvent("conversation.turn.started"));
		stream.emit(lifecycleSessionEvent("session-1", "agent_start", 100));
		stream.emit(
			mapRuntimeSessionObservationEvent("session-1", {
				type: "tool.start",
				toolCallId: "call-1",
				toolName: "bash",
				args: { command: "ls" },
				startedAt: 120,
				source: "tool",
			}),
		);
		stream.emit(
			mapRuntimeSessionObservationEvent("session-1", {
				type: "tool.end",
				toolCallId: "call-1",
				toolName: "bash",
				result: { content: [] },
				isError: false,
				startedAt: 120,
				durationMs: 30,
				phases: [],
				source: "tool",
			}),
		);
		expect(relay.readCurrentTurnId("session-key")).toBe("turn-1");

		const replayed: SessionEvent[] = [];
		const unsubscribe = relay.subscribe("session-key", handle, (event) => replayed.push(event));
		expect(replayed.filter((event) => event.type.startsWith("tool.")).map((event) => event.type)).toEqual([
			"tool.start",
			"tool.end",
		]);
		unsubscribe();

		stream.emit(turnEvent("conversation.turn.completed"));
		expect(relay.readCurrentTurnId("session-key")).toBeUndefined();
		relay.release("session-key", handle.lifecycle.sessionPath, handle.lifecycle.sessionId);
	});

	it("replays the whole running Turn with adjacent deltas merged for turn subscribers", () => {
		const stream = createEventStream();
		const handle = {
			lifecycle: { sessionId: "session-1", sessionPath: "C:/sessions/session-1.jsonl" },
			stateReader: { readState: () => ({ activeToolNames: [] }) },
			eventStream: stream,
		} as unknown as RuntimeHostSessionRecord;
		const relay = new RuntimeHostSessionEventRelay({
			queueSidecar: { persist: () => undefined } as unknown as RuntimeHostQueueSidecar,
			synchronizeSessionIdentity: () => undefined,
			reportFailure: () => undefined,
		});
		relay.attach("session-key", handle, stream);
		const base = {
			schemaVersion: 1 as const,
			channel: "runtime" as const,
			sessionId: "session-1",
			eventId: "event",
			timestamp: 1,
			source: "runtime-core" as const,
		};
		const partial = { role: "assistant", content: [{ type: "text", text: "hello" }] } as unknown as AssistantMessage;
		stream.emit({ ...base, type: "conversation.turn.started", turnId: "turn-1" });
		stream.emit(lifecycleSessionEvent("session-1", "agent_start", 1));
		stream.emit({
			...base,
			type: "conversation.message.appended",
			turnId: "turn-1",
			messageId: "user-1",
			message: { role: "user", content: "go", timestamp: 1 },
		});
		stream.emit(assistantEvent({ type: "text_delta", contentIndex: 0, delta: "hel", partial }));
		stream.emit(assistantEvent({ type: "text_delta", contentIndex: 0, delta: "lo", partial }));
		// A persisted model call ends the per-call buffer but not the Turn replay.
		stream.emit({
			...base,
			type: "usage.update",
			input: 1,
			output: 1,
			contextPercent: null,
			contextTokens: 2,
			contextWindow: 0,
		} as SessionEvent);

		const replayed: SessionEvent[] = [];
		const unsubscribe = relay.subscribe("session-key", handle, (event) => replayed.push(event), { replay: "turn" });
		const turnEvents = replayed.filter(
			(event) => event.channel === "assistant" || event.type.startsWith("conversation."),
		);
		expect(turnEvents.map((event) => event.type)).toEqual([
			"conversation.turn.started",
			"conversation.message.appended",
			"text_delta",
		]);
		expect(turnEvents[2]).toMatchObject({ delta: "hello" });
		const perCall: SessionEvent[] = [];
		relay.subscribe("session-key", handle, (event) => perCall.push(event))();
		expect(perCall.some((event) => event.channel === "assistant")).toBe(false);
		unsubscribe();

		stream.emit({ ...base, type: "conversation.turn.completed", turnId: "turn-1", stopReason: "stop" });
		const afterTurn: SessionEvent[] = [];
		relay.subscribe("session-key", handle, (event) => afterTurn.push(event), { replay: "turn" })();
		expect(afterTurn.some((event) => event.type.startsWith("conversation."))).toBe(false);
		relay.release("session-key", handle.lifecycle.sessionPath, handle.lifecycle.sessionId);
	});
});
