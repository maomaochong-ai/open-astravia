import type { RuntimeSession, SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createCodingAgentSubagentChildHandle } from "../../src/composition/subagent/child-handle.js";
import { CODING_AGENT_TODO_OBSERVATION } from "../../src/features/todo/todo-session-extension-contract.js";

describe("Coding Agent Subagent child handle", () => {
	it("publishes live todo progress from the child Session Extension observation", () => {
		const listeners = new Set<(event: SessionEvent) => void>();
		const session = {
			sessionId: "child-1",
			hasExtension: () => true,
			invokeExtensionSync: () => [
				{ id: 1, content: "inspect", status: "done" },
				{ id: 2, content: "change", status: "pending" },
			],
			subscribe: (listener: (event: SessionEvent) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			readState: () => ({ isStreaming: false }),
			readMessages: () => [],
			prompt: async () => {},
			abort: async () => {},
			dispose: async () => {},
		} as unknown as RuntimeSession;
		const handle = createCodingAgentSubagentChildHandle({
			session,
			appendContext: () => {},
			deliverContext: async () => {},
			disposeComposition: async () => {},
		});

		expect(handle.getTodoProgress?.()).toEqual({ done: 1, total: 2 });
		const progress = vi.fn();
		const unsubscribe = handle.subscribeTodos?.(progress);
		for (const listener of listeners) {
			listener({
				type: "session.extension",
				schemaVersion: 1,
				sessionId: "child-1",
				eventId: "event-1",
				timestamp: 1,
				source: "agent",
				extensionId: CODING_AGENT_TODO_OBSERVATION.extensionId,
				event: CODING_AGENT_TODO_OBSERVATION.event,
				payload: [
					{ id: 1, content: "inspect", status: "done" },
					{ id: 2, content: "change", status: "done" },
				],
			});
		}

		expect(progress).toHaveBeenCalledWith({ done: 2, total: 2 });
		unsubscribe?.();
		expect(listeners).toHaveLength(0);
	});
});
