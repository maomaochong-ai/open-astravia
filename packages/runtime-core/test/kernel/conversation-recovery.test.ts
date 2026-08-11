import type { UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	type Clock,
	type ConversationMetadata,
	type ConversationRepository,
	type ConversationSnapshot,
	type CreateConversationInput,
	type EventSink,
	type IdGenerator,
	KERNEL_ERROR_CODES,
	type KernelEvent,
	type StoredConversation as KernelStoredConversation,
	type RuntimeSnapshotProvider,
	resumeAgentSession,
	type StoredSessionEvent,
	type TurnEngineEvent,
	type TurnEnginePort,
	TurnPipeline,
} from "../../src/kernel/index.js";

class InMemoryConversationRepository implements ConversationRepository {
	private readonly conversations = new Map<string, KernelStoredConversation>();

	async create(input: CreateConversationInput): Promise<ConversationMetadata> {
		const conversation: KernelStoredConversation = {
			sessionId: input.sessionId,
			createdAt: input.createdAt,
			version: 0,
			messages: [],
			events: [],
		};
		this.conversations.set(input.sessionId, conversation);
		return conversation;
	}

	async load(sessionId: string): Promise<KernelStoredConversation> {
		const conversation = this.conversations.get(sessionId);
		if (!conversation) throw new Error(`Conversation not found: ${sessionId}`);
		return conversation;
	}

	async append(
		sessionId: string,
		expectedVersion: number,
		events: readonly StoredSessionEvent[],
	): Promise<{ readonly version: number }> {
		const conversation = await this.load(sessionId);
		if (conversation.version !== expectedVersion) throw new Error("Version conflict");
		const messages = [...conversation.messages];
		for (const event of events) {
			if (event.type === "message.appended") messages.push(event.message);
		}
		const version = expectedVersion + events.length;
		this.conversations.set(sessionId, {
			...conversation,
			version,
			messages,
			events: [...conversation.events, ...events],
		});
		return { version };
	}

	async saveSnapshot(_sessionId: string, _snapshot: ConversationSnapshot): Promise<void> {}

	async close(): Promise<void> {}
}

class TrackingSnapshotProvider implements RuntimeSnapshotProvider {
	acquireCount = 0;

	async acquire(): Promise<never> {
		this.acquireCount += 1;
		throw new Error("Recovery must not acquire a runtime snapshot");
	}
}

class TrackingTurnEngine implements TurnEnginePort {
	executeCount = 0;

	execute(): AsyncIterable<TurnEngineEvent> {
		this.executeCount += 1;
		throw new Error("Recovery must not execute a turn");
	}
}

class CollectingEventSink implements EventSink {
	readonly events: KernelEvent[] = [];

	async publish(event: KernelEvent): Promise<void> {
		this.events.push(event);
	}
}

const clock: Clock = {
	now: () => 200,
};

const idGenerator: IdGenerator = {
	next: () => "unused-turn-id",
};

function started(sessionId: string, turnId: string): StoredSessionEvent {
	return {
		type: "turn.started",
		sessionId,
		turnId,
		snapshotId: "snapshot-1",
		timestamp: 100,
	};
}

function message(sessionId: string, turnId: string): StoredSessionEvent {
	const value: UserMessage = {
		role: "user",
		content: "persisted input",
		timestamp: 101,
	};
	return {
		type: "message.appended",
		sessionId,
		turnId,
		message: value,
		timestamp: 101,
	};
}

function completed(sessionId: string, turnId: string): StoredSessionEvent {
	return {
		type: "turn.completed",
		sessionId,
		turnId,
		stopReason: "stop",
		timestamp: 102,
	};
}

function createHarness() {
	const repository = new InMemoryConversationRepository();
	const snapshotProvider = new TrackingSnapshotProvider();
	const turnEngine = new TrackingTurnEngine();
	const eventSink = new CollectingEventSink();
	const pipeline = new TurnPipeline({
		repository,
		snapshotProvider,
		turnEngine,
		eventSink,
		clock,
		idGenerator,
	});
	return { eventSink, pipeline, repository, snapshotProvider, turnEngine };
}

describe("conversation recovery", () => {
	it("interrupts one incomplete turn before exposing an idle resumed session", async () => {
		const harness = createHarness();
		await harness.repository.create({ sessionId: "session-1", createdAt: 1 });
		await harness.repository.append("session-1", 0, [started("session-1", "turn-1"), message("session-1", "turn-1")]);

		const session = await resumeAgentSession({ id: "session-1", pipeline: harness.pipeline });

		expect(session.state).toBe("idle");
		const conversation = await harness.repository.load("session-1");
		expect(conversation.messages).toHaveLength(1);
		expect(conversation.events.at(-1)).toMatchObject({
			type: "turn.failed",
			turnId: "turn-1",
			error: {
				code: KERNEL_ERROR_CODES.TURN_INTERRUPTED,
				message: "Turn interrupted before the session was resumed",
			},
		});
		expect(harness.eventSink.events).toEqual([conversation.events.at(-1)]);
		expect(harness.snapshotProvider.acquireCount).toBe(0);
		expect(harness.turnEngine.executeCount).toBe(0);
	});

	it("is idempotent after an incomplete turn has been recovered", async () => {
		const harness = createHarness();
		await harness.repository.create({ sessionId: "session-1", createdAt: 1 });
		await harness.repository.append("session-1", 0, [started("session-1", "turn-1")]);

		await resumeAgentSession({ id: "session-1", pipeline: harness.pipeline });
		await resumeAgentSession({ id: "session-1", pipeline: harness.pipeline });

		const conversation = await harness.repository.load("session-1");
		expect(conversation.version).toBe(2);
		expect(conversation.events.filter((event) => event.type === "turn.failed")).toHaveLength(1);
		expect(harness.eventSink.events).toHaveLength(1);
	});

	it("does not append recovery events to a completed conversation", async () => {
		const harness = createHarness();
		await harness.repository.create({ sessionId: "session-1", createdAt: 1 });
		await harness.repository.append("session-1", 0, [
			started("session-1", "turn-1"),
			completed("session-1", "turn-1"),
		]);

		await resumeAgentSession({ id: "session-1", pipeline: harness.pipeline });

		expect((await harness.repository.load("session-1")).version).toBe(2);
		expect(harness.eventSink.events).toHaveLength(0);
	});

	it("accepts manual compaction between completed turns", async () => {
		const harness = createHarness();
		await harness.repository.create({ sessionId: "session-1", createdAt: 1 });
		await harness.repository.append("session-1", 0, [
			started("session-1", "turn-1"),
			completed("session-1", "turn-1"),
			{
				type: "context.compacted",
				sessionId: "session-1",
				record: {
					summary: "manual summary",
					summaryMessage: { role: "user", content: "manual summary", timestamp: 103 },
					firstKeptEntryId: "event-1",
					tokensBefore: 100,
					reason: "manual",
				},
				timestamp: 103,
			},
		]);

		await resumeAgentSession({ id: "session-1", pipeline: harness.pipeline });

		expect((await harness.repository.load("session-1")).version).toBe(3);
		expect(harness.eventSink.events).toHaveLength(0);
	});

	it("rejects manual compaction inside an active turn", async () => {
		const harness = createHarness();
		await harness.repository.create({ sessionId: "session-1", createdAt: 1 });
		await harness.repository.append("session-1", 0, [
			started("session-1", "turn-1"),
			{
				type: "context.compacted",
				sessionId: "session-1",
				record: {
					summary: "manual summary",
					summaryMessage: { role: "user", content: "manual summary", timestamp: 101 },
					firstKeptEntryId: "event-1",
					tokensBefore: 100,
					reason: "manual",
				},
				timestamp: 101,
			},
		]);

		await expect(resumeAgentSession({ id: "session-1", pipeline: harness.pipeline })).rejects.toMatchObject({
			code: KERNEL_ERROR_CODES.TURN_PROTOCOL,
		});

		expect((await harness.repository.load("session-1")).version).toBe(2);
		expect(harness.eventSink.events).toHaveLength(0);
	});

	it.each<readonly [string, readonly StoredSessionEvent[]]>([
		["overlapping turns", [started("session-1", "turn-1"), started("session-1", "turn-2")]],
		["terminal event without a start", [completed("session-1", "turn-1")]],
		["terminal event for another turn", [started("session-1", "turn-1"), completed("session-1", "turn-2")]],
	])("fails closed for %s", async (_name, events) => {
		const harness = createHarness();
		await harness.repository.create({ sessionId: "session-1", createdAt: 1 });
		await harness.repository.append("session-1", 0, events);
		const version = events.length;

		await expect(resumeAgentSession({ id: "session-1", pipeline: harness.pipeline })).rejects.toMatchObject({
			code: KERNEL_ERROR_CODES.TURN_PROTOCOL,
		});

		expect((await harness.repository.load("session-1")).version).toBe(version);
		expect(harness.eventSink.events).toHaveLength(0);
	});
});
