import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, Message, Model, UserMessage } from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAgentSession,
	type EventSink,
	type RuntimeSnapshot,
	resumeAgentSession,
	StaticRuntimeSnapshotProvider,
	type TurnEngineEvent,
	type TurnEnginePort,
	type TurnEngineRequest,
	TurnPipeline,
} from "../../../runtime-core/src/kernel/index.js";
import { KernelRuntimeSessionBackend, RuntimeModel } from "../../../runtime-core/src/runtime-host/index.js";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("FileConversationRepository Greenfield projection", () => {
	it("rehydrates the synchronous core state from a real file repository", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-greenfield-projection-"));
		temporaryRoots.push(rootDir);
		const createdSession = await createBackend(rootDir).create({ id: "session-1" });
		const createdAssembly = createdSession.createCoreAssembly();

		await createdAssembly.corePorts.turnControl.prompt({ text: "persist me" });

		expect(createdAssembly.corePorts.stateReader.readState()).toMatchObject({
			isStreaming: false,
			messageCount: 2,
		});
		expect(createdAssembly.corePorts.stateReader.readMessages().map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		const createdHistory = createdAssembly.historyReader.readHistory();
		expect(createdHistory).toMatchObject([
			{ type: "message", entryId: "event-2", parentId: null, message: { role: "user" } },
			{ type: "message", entryId: "event-3", parentId: "event-2", message: { role: "assistant" } },
		]);
		expect(createdAssembly.lifecycle.sessionPath).toMatch(/\.conversation\.jsonl$/);
		await createdAssembly.lifecycle.dispose();

		const resumedSession = await createBackend(rootDir).resume({ id: "session-1" });
		const resumedAssembly = resumedSession.createCoreAssembly();

		expect(resumedAssembly.corePorts.stateReader.readState()).toMatchObject({
			isStreaming: false,
			messageCount: 2,
		});
		expect(resumedAssembly.corePorts.stateReader.readMessages().map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(resumedAssembly.historyReader.readHistory()).toEqual(createdHistory);
		expect(resumedAssembly.lifecycle.sessionPath).toBe(createdAssembly.lifecycle.sessionPath);
		await resumedAssembly.lifecycle.dispose();
	});

	it("persists history control and sends only the selected branch to the turn engine", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-greenfield-history-"));
		temporaryRoots.push(rootDir);
		const turnEngine = new RecordingTurnEngine();
		const backend = createBackend(rootDir, turnEngine);
		const session = await backend.create({ id: "session-1" });
		const assembly = session.createCoreAssembly();

		await assembly.corePorts.turnControl.prompt({ text: "first" });
		expect(await assembly.historyController.navigateForEdit("event-2")).toEqual({
			text: "first",
			cancelled: false,
		});
		expect(assembly.corePorts.stateReader.readMessages()).toEqual([]);

		await assembly.corePorts.turnControl.prompt({ text: "replacement" });
		expect(await assembly.historyController.switchBranch("event-2")).toEqual({ leafId: "event-3" });
		await assembly.corePorts.turnControl.prompt({ text: "old follow-up" });
		expect(turnEngine.inputs.map((messages) => messages.map(messageText))).toEqual([
			["first"],
			["replacement"],
			["first", "persisted response", "old follow-up"],
		]);

		expect(await assembly.historyController.switchBranch("event-6")).toEqual({ leafId: "event-7" });
		expect(assembly.corePorts.stateReader.readMessages().map(messageText)).toEqual([
			"replacement",
			"persisted response",
		]);
		expect(await assembly.historyController.replaceLastUserMessage("event-6")).toEqual({ leafId: null });

		await assembly.corePorts.turnControl.prompt({ text: "final" });
		await assembly.historyController.setName("renamed session");
		const fork = await assembly.historyController.forkSession("event-14");
		expect(fork.text).toBe("final");
		expect(fork.path).toMatch(/\.conversation\.jsonl$/);
		await assembly.lifecycle.dispose();

		const resumed = await backend.resume({ id: "session-1" });
		const resumedAssembly = resumed.createCoreAssembly();
		expect(resumedAssembly.corePorts.stateReader.readMessages().map(messageText)).toEqual([
			"final",
			"persisted response",
		]);
		const repository = new FileConversationRepository({ rootDir });
		expect(await repository.readDocument("session-1")).toMatchObject({
			journalVersion: 16,
			revision: 13,
			name: "renamed session",
			activeLeafId: "event-15",
		});
		await repository.close();
		await resumedAssembly.lifecycle.dispose();
	});

	it("preserves runtime rename while a turn is active", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-greenfield-rename-"));
		temporaryRoots.push(rootDir);
		const turnEngine = new BlockingTurnEngine();
		const session = await createBackend(rootDir, turnEngine).create({ id: "session-1" });
		const assembly = session.createCoreAssembly();
		const prompt = assembly.corePorts.turnControl.prompt({ text: "running" });
		await turnEngine.started;

		try {
			await assembly.historyController.setName("  renamed while running  ");
		} finally {
			turnEngine.finish();
		}
		await prompt;

		const repository = new FileConversationRepository({ rootDir });
		expect(await repository.readDocument("session-1")).toMatchObject({
			journalVersion: 4,
			revision: 3,
			name: "renamed while running",
			activeLeafId: "event-3",
		});
		await repository.close();
		await assembly.lifecycle.dispose();
	});
});

function createBackend(
	rootDir: string,
	turnEngine: TurnEnginePort = new CompletingTurnEngine(),
): KernelRuntimeSessionBackend<{ readonly id: string }> {
	return new KernelRuntimeSessionBackend({
		runtimeFactory: {
			create: (options, eventSink) => createAssembly("create", rootDir, options.id, eventSink, turnEngine),
			resume: (options, eventSink) => createAssembly("resume", rootDir, options.id, eventSink, turnEngine),
		},
	});
}

async function createAssembly(
	operation: "create" | "resume",
	rootDir: string,
	sessionId: string,
	eventSink: EventSink,
	turnEngine: TurnEnginePort,
) {
	let turnIndex = 0;
	const repository = new FileConversationRepository({ rootDir });
	const modelRuntime = new RuntimeModel({
		initialModel: TEST_MODEL,
		initialThinkingLevel: "off",
		catalog: {
			refresh() {},
			listAvailable: () => [TEST_MODEL],
			find: (provider, modelId) =>
				TEST_MODEL.provider === provider && TEST_MODEL.id === modelId ? TEST_MODEL : undefined,
		},
		credentials: {
			resolve: async () => "test-key",
			refreshAuth: async () => {},
		},
	});
	const pipeline = new TurnPipeline({
		repository,
		snapshotProvider: new StaticRuntimeSnapshotProvider(snapshot(), modelRuntime),
		turnEngine,
		eventSink,
		clock: { now: () => Date.now() },
		idGenerator: {
			next: () => {
				turnIndex += 1;
				return `turn-${turnIndex}`;
			},
		},
	});
	const session =
		operation === "create"
			? await createAgentSession({ id: sessionId, pipeline })
			: await resumeAgentSession({ id: sessionId, pipeline });
	return {
		session,
		repository,
		conversationDocumentStore: repository,
		promptAdapter: {
			createRequest(request: { readonly text: string }) {
				return { payload: request, displayText: request.text };
			},
			async prepare(request: { readonly payload: unknown }) {
				const prompt = request.payload as { readonly text: string };
				return { action: "continue" as const, input: { message: userMessage(prompt.text) } };
			},
		},
		modelRuntime,
		identity: {
			cwd: rootDir,
			sessionPath: repository.resolveConversationPath(sessionId),
		},
		stateSource: {
			read: () => ({
				contextPercent: null,
				contextWindow: 8_000,
				activeToolNames: [] as string[],
			}),
		},
		dispose: () => repository.close(),
	};
}

const TEST_MODEL: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

class CompletingTurnEngine implements TurnEnginePort {
	async *execute(): AsyncIterable<TurnEngineEvent> {
		yield { type: "message", message: assistantMessage("persisted response") };
		yield { type: "completed", stopReason: "stop" };
	}
}

class RecordingTurnEngine implements TurnEnginePort {
	readonly inputs: Message[][] = [];

	async *execute(request: TurnEngineRequest): AsyncIterable<TurnEngineEvent> {
		this.inputs.push([...request.messages]);
		yield { type: "message", message: assistantMessage("persisted response") };
		yield { type: "completed", stopReason: "stop" };
	}
}

class BlockingTurnEngine implements TurnEnginePort {
	readonly started: Promise<void>;
	private readonly released: Promise<void>;
	private markStarted: () => void = () => {};
	private release: () => void = () => {};

	constructor() {
		this.started = new Promise((resolve) => {
			this.markStarted = resolve;
		});
		this.released = new Promise((resolve) => {
			this.release = resolve;
		});
	}

	finish(): void {
		this.release();
	}

	async *execute(): AsyncIterable<TurnEngineEvent> {
		this.markStarted();
		await this.released;
		yield { type: "message", message: assistantMessage("persisted response") };
		yield { type: "completed", stopReason: "stop" };
	}
}

function snapshot(): RuntimeSnapshot {
	return {
		id: "snapshot-1",
		instructions: [],
		tools: new Map(),
		contextProviders: [],
		contextStrategy: {
			async prepare(input) {
				return { messages: input.messages, estimatedTokens: input.messages.length };
			},
		},
		toolPolicy: {
			async authorize() {
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
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
		timestamp: 2,
	};
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("");
}
