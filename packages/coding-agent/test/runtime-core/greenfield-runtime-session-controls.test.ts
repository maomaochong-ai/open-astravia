import type {
	ConversationDocument,
	GreenfieldRuntimeResourceContext,
	RuntimeMessageEnvelope,
} from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentMemoryController } from "../../src/adapters/runtime-core/greenfield-memory-controller.js";
import { createGreenfieldRuntimeSessionControls } from "../../src/composition/greenfield-runtime-session-controls.js";
import type { GreenfieldSessionExecutionRuntime } from "../../src/composition/greenfield-session-execution-runtime.js";
import { InMemoryGreenfieldSessionValueIndex } from "../../src/composition/greenfield-session-resource-index.js";
import type {
	GreenfieldSessionHookController,
	GreenfieldSessionResourceIndexes,
} from "../../src/composition/greenfield-session-resource-lifecycle-assembly.js";

describe("Greenfield Runtime Session Controls", () => {
	it("delegates through live Session resource indexes and conversation projection ports", async () => {
		const fixture = createFixture();
		const controls = fixture.controls;
		const end = vi.fn(async () => {});
		const start = vi.fn();
		const discard = vi.fn();
		const append = vi.fn();
		const deliverAsyncContext = vi.fn(async () => {});
		const quiesceBackgroundCommands = vi.fn(async () => {});
		const flushMemory = vi.fn(async () => 7);
		const reloadMcp = vi.fn(async () => undefined);
		fixture.reloadMcp.mockImplementation(reloadMcp);
		fixture.indexes.hookSessionControllers.set("session", { end, start, discard });
		fixture.indexes.resourceContexts.set("session", {
			contextAppender: { append },
			deliverAsyncContext,
		} as unknown as GreenfieldRuntimeResourceContext);
		fixture.indexes.executionRuntimes.set("session", {
			quiesceBackgroundCommands,
		} as unknown as GreenfieldSessionExecutionRuntime);
		fixture.indexes.memoryControllers.set("session", { flushMemory } satisfies CodingAgentMemoryController);
		const records: SessionContextRecord[] = [{ type: "test", content: "context", modelVisible: true }];
		const signal = new AbortController().signal;

		await controls.sessionHooks.end("session", "new_session");
		controls.sessionHooks.start("session", "resume");
		controls.sessionHooks.discard("session");
		controls.appendSessionContext("session", records);
		await controls.deliverSessionContext("session", records);
		await controls.quiesceSessionBackgroundCommands("session");
		await expect(controls.flushMemory("session", signal)).resolves.toBe(7);
		await controls.reloadMcp("session");
		await controls.preserveSessionExecutionContext("source", "target");
		controls.clearSessionExecutionContext("target");

		expect(end).toHaveBeenCalledWith("new_session");
		expect(start).toHaveBeenCalledWith("resume");
		expect(discard).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledWith(records);
		expect(deliverAsyncContext).toHaveBeenCalledWith(records);
		expect(quiesceBackgroundCommands).toHaveBeenCalledOnce();
		expect(flushMemory).toHaveBeenCalledWith(signal);
		expect(reloadMcp).toHaveBeenCalledWith("session");
		expect(fixture.readConversationDocument.mock.calls.map(([sessionId]) => sessionId)).toEqual(["source", "target"]);
		expect(fixture.projectConversationContext).toHaveBeenCalledWith(fixture.sourceDocument);
		expect(fixture.projectConversationSeed).toHaveBeenCalledWith(fixture.targetDocument);
		expect(fixture.preserveConversationContext).toHaveBeenCalledWith(
			"target",
			fixture.sourceProjection,
			fixture.targetSeed,
		);
		expect(fixture.clearConversationContext).toHaveBeenCalledWith("target");
	});

	it("preserves missing-resource errors and optional no-op behavior", async () => {
		const { controls } = createFixture();
		const records: SessionContextRecord[] = [{ type: "test", content: "context", modelVisible: true }];

		await expect(controls.sessionHooks.end("missing", "dispose")).rejects.toThrow(
			"Greenfield session hook lifecycle not found: missing",
		);
		expect(() => controls.sessionHooks.start("missing", "resume")).toThrow(
			"Greenfield session hook lifecycle not found: missing",
		);
		expect(() => controls.sessionHooks.discard("missing")).toThrow(
			"Greenfield session hook lifecycle not found: missing",
		);
		expect(() => controls.appendSessionContext("missing", records)).toThrow(
			"Greenfield session context not found: missing",
		);
		await expect(controls.deliverSessionContext("missing", records)).rejects.toThrow(
			"Greenfield session context not found: missing",
		);
		await expect(controls.quiesceSessionBackgroundCommands("missing")).resolves.toBeUndefined();
		await expect(controls.flushMemory("missing")).resolves.toBe(0);
		await expect(controls.reloadMcp("missing")).resolves.toBeUndefined();
	});
});

function createFixture() {
	const indexes = {
		executionRuntimes: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionExecutionRuntime>(),
		hookSessionControllers: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionHookController>(),
		memoryControllers: new InMemoryGreenfieldSessionValueIndex<CodingAgentMemoryController>(),
		resourceContexts: new InMemoryGreenfieldSessionValueIndex<GreenfieldRuntimeResourceContext>(),
	} satisfies Pick<
		GreenfieldSessionResourceIndexes,
		"executionRuntimes" | "hookSessionControllers" | "memoryControllers" | "resourceContexts"
	>;
	const sourceDocument = conversationDocument("source");
	const targetDocument = conversationDocument("target");
	const sourceProjection: readonly RuntimeMessageEnvelope[] = Object.freeze([]);
	const targetSeed: readonly RuntimeMessageEnvelope[] = Object.freeze([]);
	const readConversationDocument = vi.fn(async (sessionId: string) =>
		sessionId === "source" ? sourceDocument : targetDocument,
	);
	const projectConversationContext = vi.fn(() => sourceProjection);
	const projectConversationSeed = vi.fn(() => targetSeed);
	const preserveConversationContext = vi.fn();
	const clearConversationContext = vi.fn();
	const reloadMcp = vi.fn(async () => undefined);
	return {
		indexes,
		sourceDocument,
		targetDocument,
		sourceProjection,
		targetSeed,
		readConversationDocument,
		projectConversationContext,
		projectConversationSeed,
		preserveConversationContext,
		clearConversationContext,
		reloadMcp,
		controls: createGreenfieldRuntimeSessionControls({
			indexes,
			readConversationDocument,
			projectConversationContext,
			projectConversationSeed,
			preserveConversationContext,
			clearConversationContext,
			reloadMcp,
		}),
	};
}

function conversationDocument(sessionId: string): ConversationDocument {
	return {
		identity: { sessionId, createdAt: 1 },
		journalVersion: 0,
		revision: 0,
		entries: [],
		activeLeafId: null,
	};
}
