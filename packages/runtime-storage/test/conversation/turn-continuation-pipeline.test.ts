import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message, UserMessage } from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAgentSession,
	type EventSink,
	FailInterruptedTurnRecoveryPolicy,
	type KernelEvent,
	type RuntimeSnapshot,
	StaticRuntimeSnapshotProvider,
	type TurnEngineContextCheckpointResult,
	type TurnEngineEvent,
	type TurnEnginePort,
	type TurnEngineRequest,
	TurnPipeline,
} from "../../../runtime-core/src/kernel/index.js";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("TurnPipeline conversation continuation", () => {
	it("rebinds the active AgentSession and finishes the same turn in the target conversation", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-continuation-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		const eventSink = new RecordingEventSink();
		const turnEngine = new CheckpointTurnEngine();
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot()),
			turnEngine,
			eventSink,
			clock: { now: () => 10 },
			idGenerator: { next: () => "turn-1" },
			conversationDocumentReader: repository,
			conversationContinuationStore: repository,
		});
		const session = await createAgentSession({ id: "source-session", pipeline });

		const result = await session.send({ message: userMessage("keep me", 1) });

		expect(result).toMatchObject({
			status: "completed",
			sessionId: session.id,
			turnId: "turn-1",
			stopReason: "stop",
		});
		expect(session.id).not.toBe("source-session");
		expect(turnEngine.sessionIdAfterCheckpoint).toBe(session.id);
		expect(eventSink.events.map((event) => event.type)).toContain("conversation.continued");

		const source = await repository.load("source-session");
		expect(source.events.map((event) => event.type)).toEqual([
			"turn.started",
			"message.appended",
			"context.compacted",
			"turn.transferred",
		]);
		expect(new FailInterruptedTurnRecoveryPolicy().plan(source)).toEqual({ status: "ready" });

		const target = await repository.load(session.id);
		expect(target.events.map((event) => event.type)).toEqual([
			"turn.continued",
			"message.appended",
			"turn.completed",
		]);
		expect(target.messages.map(messageText)).toEqual(["summary", "keep me", "continued response"]);
		expect(new FailInterruptedTurnRecoveryPolicy().plan(target)).toEqual({ status: "ready" });
		await session.close();
		await repository.close();
	});

	it("records a terminal failure in the target conversation when runtime rebinding fails", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-continuation-failure-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot("turn_start")),
			turnEngine: new CheckpointTurnEngine(),
			eventSink: new RecordingEventSink(),
			clock: { now: () => 10 },
			idGenerator: { next: () => "turn-1" },
			conversationDocumentReader: repository,
			conversationContinuationStore: repository,
			onConversationContinued: () => {
				throw new Error("runtime rebinding failed");
			},
		});
		const session = await createAgentSession({ id: "source-session", pipeline });

		const result = await session.send({ message: userMessage("keep me", 1) });

		expect(result).toMatchObject({
			status: "failed",
			sessionId: session.id,
			turnId: "turn-1",
			error: { message: "runtime rebinding failed" },
		});
		expect(session.id).not.toBe("source-session");
		const target = await repository.load(session.id);
		expect(target.events.map((event) => event.type)).toEqual(["turn.continued", "turn.failed"]);
		expect(new FailInterruptedTurnRecoveryPolicy().plan(target)).toEqual({ status: "ready" });
		await session.close();
		await repository.close();
	});

	it("finalizes compaction only after the continuation transaction and runtime rebinding", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-continuation-finalization-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		const trace: string[] = [];
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot("model_call", { trace })),
			turnEngine: new CheckpointTurnEngine(),
			eventSink: new RecordingEventSink(),
			clock: { now: () => 10 },
			idGenerator: { next: () => "turn-1" },
			conversationDocumentReader: repository,
			conversationContinuationStore: repository,
			onConversationContinued: () => {
				trace.push("runtime-rebound");
			},
		});
		const session = await createAgentSession({ id: "source-session", pipeline });

		const result = await session.send({ message: userMessage("keep me", 1) });

		expect(result.status).toBe("completed");
		expect(trace).toEqual(["compaction-committed", "runtime-rebound", "continuation-finalized"]);
		await session.close();
		await repository.close();
	});

	it("notifies the context strategy when the continuation transaction fails without running success finalization", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-continuation-store-failure-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		const trace: string[] = [];
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot("model_call", { trace })),
			turnEngine: new CheckpointTurnEngine(),
			eventSink: new RecordingEventSink(),
			clock: { now: () => 10 },
			idGenerator: { next: () => "turn-1" },
			conversationDocumentReader: repository,
			conversationContinuationStore: {
				async continueConversation() {
					trace.push("continuation-transaction");
					throw new Error("continuation store failed");
				},
			},
		});
		const session = await createAgentSession({ id: "source-session", pipeline });

		const result = await session.send({ message: userMessage("keep me", 1) });

		expect(result).toMatchObject({
			status: "failed",
			sessionId: "source-session",
			error: { message: "continuation store failed" },
		});
		expect(trace).toEqual(["compaction-committed", "continuation-transaction", "continuation-failed"]);
		await session.close();
		await repository.close();
	});

	it("uses post-continuation finalization to stop overflow recovery retry", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-continuation-stop-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		const turnEngine = new CheckpointTurnEngine("assistant_error");
		const pipeline = new TurnPipeline({
			repository,
			snapshotProvider: new StaticRuntimeSnapshotProvider(
				snapshot("assistant_error", { compactionReason: "overflow", finalContinueExecution: false }),
			),
			turnEngine,
			eventSink: new RecordingEventSink(),
			clock: { now: () => 10 },
			idGenerator: { next: () => "turn-1" },
			conversationDocumentReader: repository,
			conversationContinuationStore: repository,
		});
		const session = await createAgentSession({ id: "source-session", pipeline });

		const result = await session.send({ message: userMessage("keep me", 1) });

		expect(result.status).toBe("completed");
		expect(turnEngine.checkpointResult?.retry).toBe(false);
		await session.close();
		await repository.close();
	});
});

class RecordingEventSink implements EventSink {
	readonly events: KernelEvent[] = [];

	async publish(event: KernelEvent): Promise<void> {
		this.events.push(event);
	}
}

class CheckpointTurnEngine implements TurnEnginePort {
	sessionIdAfterCheckpoint: string | undefined;
	checkpointResult: TurnEngineContextCheckpointResult | undefined;

	constructor(
		private readonly checkpointReason: "assistant_error" | "assistant_result" | "model_call" = "model_call",
	) {}

	async *execute(request: TurnEngineRequest): AsyncIterable<TurnEngineEvent> {
		this.checkpointResult = await request.checkpoint?.(
			{
				reason: this.checkpointReason,
				messages: request.messages,
				recoveryAttempt: 0,
			},
			request.signal,
		);
		this.sessionIdAfterCheckpoint = request.sessionId;
		yield { type: "message", message: assistantMessage("continued response", 2) };
		yield { type: "completed", stopReason: "stop" };
	}
}

function snapshot(
	compactOn: "assistant_error" | "model_call" | "turn_start" = "model_call",
	options: {
		readonly trace?: string[];
		readonly compactionReason?: "overflow" | "threshold";
		readonly finalContinueExecution?: boolean;
	} = {},
): RuntimeSnapshot {
	return {
		id: "snapshot-1",
		instructions: [],
		tools: new Map(),
		contextProviders: [],
		contextStrategy: {
			async prepare(input) {
				if (input.reason !== compactOn) {
					return { messages: input.messages, estimatedTokens: input.messages.length };
				}
				return {
					messages: [userMessage("summary", 2), ...input.messages],
					estimatedTokens: input.messages.length,
					compaction: {
						summary: "summary",
						summaryMessage: userMessage("summary", 2),
						firstKeptEntryId: "event-2",
						tokensBefore: 1_000,
						reason: options.compactionReason ?? "threshold",
					},
				};
			},
			async onCompactionCommitted() {
				options.trace?.push("compaction-committed");
				return {
					continueExecution: true,
					continuation: { reason: "memory-rollover" },
				};
			},
			async onCompactionContinuationCommitted() {
				options.trace?.push("continuation-finalized");
				return { continueExecution: options.finalContinueExecution ?? true };
			},
			async onCompactionContinuationFailed() {
				options.trace?.push("continuation-failed");
			},
		},
		toolPolicy: { authorize: async () => true },
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
}

function userMessage(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}

function assistantMessage(text: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "test",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("");
}
