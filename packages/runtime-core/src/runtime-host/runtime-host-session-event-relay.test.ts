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

		unsubscribeReplay();
		unsubscribeLive();
		relay.release("session-key", handle.lifecycle.sessionPath, handle.lifecycle.sessionId);
	});
});
