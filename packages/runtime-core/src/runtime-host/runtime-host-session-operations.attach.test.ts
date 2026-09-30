import { describe, expect, it } from "vitest";
import type { HistoryEntry, SessionEvent } from "../contracts.js";
import type { RuntimeHostSessionDirectory } from "./runtime-host-session-directory.js";
import type { RuntimeHostSessionEventRelay } from "./runtime-host-session-event-relay.js";
import { RuntimeHostSessionOperations } from "./runtime-host-session-operations.js";
import type { RuntimeHostSessionRecord } from "./types.js";

describe("RuntimeHostSessionOperations.attach", () => {
	it("reads history in the same step that registers the subscriber and replays the running Turn", () => {
		const steps: string[] = [];
		const history: HistoryEntry[] = [
			{ type: "message", entryId: "e1", message: { role: "user", content: "go", timestamp: 1 } },
		];
		const handle = {
			historyReader: {
				readHistory: () => {
					steps.push("history");
					return history;
				},
			},
		} as unknown as RuntimeHostSessionRecord;
		const events = {
			subscribe: (
				_key: string,
				_handle: RuntimeHostSessionRecord,
				handler: (event: SessionEvent) => void,
				options?: { replay?: string },
			) => {
				steps.push(`subscribe:${options?.replay}`);
				handler({ type: "conversation.turn.started", turnId: "turn-1" } as SessionEvent);
				return () => steps.push("unsubscribe");
			},
			readCurrentTurnId: () => "turn-1",
		} as unknown as RuntimeHostSessionEventRelay;
		const operations = new RuntimeHostSessionOperations({
			directory: { resolveSessionKey: () => "key", get: () => handle } as unknown as RuntimeHostSessionDirectory,
			events,
			synchronizeSessionIdentity: () => undefined,
			reportWorkspacePreparationFailure: () => undefined,
		});

		const received: SessionEvent[] = [];
		const attachment = operations.attach("session-1", (event) => {
			steps.push(`event:${event.type}`);
			received.push(event);
		});

		expect(steps).toEqual(["subscribe:turn", "event:conversation.turn.started", "history"]);
		expect(attachment.history).toEqual(history);
		expect(attachment.history).not.toBe(history);
		expect(attachment.runningTurnId).toBe("turn-1");
		attachment.unsubscribe();
		expect(steps.at(-1)).toBe("unsubscribe");
	});
});
