import type { SessionEvent } from "@vetta/runtime-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PetCommand } from "../../shared/pet-ipc.js";
import {
	PET_PRESENTATION_MIN_HOLD_MS,
	PetSessionPresentationController,
} from "./pet-session-presentation-controller.js";

const eventBase = {
	schemaVersion: 1,
	sessionId: "session-1",
	eventId: "event-1",
	timestamp: 1,
	source: "runtime-core",
} as const;

function lifecycle(phase: Extract<SessionEvent, { type: "session.lifecycle" }>["phase"]): SessionEvent {
	return { ...eventBase, type: "session.lifecycle", phase };
}

function stateCommands(commands: readonly PetCommand[]) {
	return commands.filter((command) => command.type === "set-state");
}

describe("PetSessionPresentationController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces rapid session changes and displays only the latest state every three seconds", () => {
		const commands: PetCommand[] = [];
		const controller = new PetSessionPresentationController({ send: (command) => commands.push(command) });

		controller.handleSessionEvent(lifecycle("agent_start"));
		controller.handleSessionEvent({
			...eventBase,
			type: "tool.start",
			toolCallId: "tool-1",
			toolName: "read",
			args: {},
			startedAt: 1,
			source: "tool",
		});
		controller.beginWaiting("session-1", "question:q-1", "notice.waiting.question");

		expect(stateCommands(commands).map((command) => command.state)).toEqual(["thinking"]);
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS - 1);
		expect(stateCommands(commands).map((command) => command.state)).toEqual(["thinking"]);

		vi.advanceTimersByTime(1);
		expect(stateCommands(commands).map((command) => command.state)).toEqual(["thinking", "waiting_input"]);

		controller.dispose();
	});

	it("restores work after confirmation and shows success for a full state interval before idle", () => {
		const commands: PetCommand[] = [];
		const controller = new PetSessionPresentationController({ send: (command) => commands.push(command) });

		controller.handleSessionEvent(lifecycle("agent_start"));
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);
		controller.handleSessionEvent({
			...eventBase,
			type: "tool.start",
			toolCallId: "tool-1",
			toolName: "read",
			args: {},
			startedAt: 1,
			source: "tool",
		});
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);

		controller.beginWaiting("session-1", "question:q-1", "notice.waiting.question");
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);
		controller.endWaiting("session-1", "question:q-1");
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);
		controller.handleSessionEvent(lifecycle("agent_end"));
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);

		expect(stateCommands(commands).map((command) => command.state)).toEqual([
			"thinking",
			"working",
			"waiting_input",
			"working",
			"success",
			"idle",
		]);

		controller.dispose();
	});

	it("does not replace a terminal error with success when agent_end arrives", () => {
		const commands: PetCommand[] = [];
		const controller = new PetSessionPresentationController({ send: (command) => commands.push(command) });

		controller.handleSessionEvent(lifecycle("agent_start"));
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);
		controller.handleSessionEvent({
			...eventBase,
			type: "error",
			error: { code: "boom", message: "failed", retryable: false, origin: "runtime" },
		});
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS);
		controller.handleSessionEvent(lifecycle("agent_end"));
		vi.advanceTimersByTime(PET_PRESENTATION_MIN_HOLD_MS * 2);

		expect(stateCommands(commands).map((command) => command.state)).toEqual(["thinking", "error"]);

		controller.dispose();
	});
});
