import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import {
	createGreenfieldRuntimeComposition,
	GreenfieldRuntimeHostSessionBackend,
} from "@vetta/coding-agent/composition";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { RuntimeHost } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";

describe("GreenfieldRuntimeHostSessionBackend", () => {
	const directories: string[] = [];
	const disposers: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const dispose of disposers.splice(0).reverse()) await dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("maps supported RuntimeHost session options and resumes the persisted conversation", async () => {
		const cwd = await temporaryDirectory("greenfield-host-workspace-");
		const conversationDir = await temporaryDirectory("greenfield-host-conversations-");
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
		});
		const backend = new GreenfieldRuntimeHostSessionBackend({
			composition,
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
		});
		const runtime = new RuntimeHost({ sessionBackend: backend });
		disposers.push(async () => {
			await runtime.disposeAllSessions();
			await composition.dispose();
		});

		const created = await runtime.createSession({
			cwd,
			sessionDir: conversationDir,
			scenario: "batch",
			model: SECOND_MODEL,
			thinkingLevel: "medium",
			executionMode: "full-access",
			enableBackgroundTasks: false,
			includeAgentSkills: false,
			appendSystemPrompt: "runtime-host-addon",
		});
		const createdSession = backend.readSession(created.sessionId);

		expect(createdSession).toBeDefined();
		expect(runtime.getState(created.sessionId)).toMatchObject({
			model: SECOND_MODEL,
			thinkingLevel: "medium",
			executionMode: "full-access",
			scenario: "batch",
		});
		expect(runtime.getState(created.sessionId).activeToolNames).not.toContain("task_output");
		expect(backend.readAssessment(created.sessionId)).toMatchObject({ ready: true });
		const sessionPath = runtime.getSessionPath(created.sessionId);
		expect(sessionPath).toBeDefined();
		await runtime.disposeSession(created.sessionId);
		expect(backend.readSession(created.sessionId)).toBeUndefined();

		const resumed = await runtime.createSession({
			cwd,
			sessionDir: conversationDir,
			sessionPath,
			scenario: "batch",
			executionMode: "full-access",
		});
		expect(resumed.sessionId).toBe(created.sessionId);

		const whitespacePath = await runtime.createSession({
			cwd,
			sessionDir: conversationDir,
			sessionPath: "   ",
			scenario: "batch",
		});
		expect(whitespacePath.sessionId).not.toBe(created.sessionId);
	});

	it("fails closed for composition and serverUrl mismatches", async () => {
		const cwd = await temporaryDirectory("greenfield-host-gate-workspace-");
		const conversationDir = await temporaryDirectory("greenfield-host-gate-conversations-");
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
		});
		const backend = new GreenfieldRuntimeHostSessionBackend({
			composition,
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			serverUrl: "https://expected.test",
		});
		const runtime = new RuntimeHost({
			sessionBackend: backend,
			serverUrl: "https://received.test",
		});
		disposers.push(async () => {
			await runtime.disposeAllSessions();
			await composition.dispose();
		});

		await expect(
			runtime.createSession({
				cwd: join(cwd, "other"),
				sessionDir: conversationDir,
				scenario: "batch",
			}),
		).rejects.toThrow("cwd mismatch");
		await expect(
			runtime.createSession({
				cwd,
				sessionDir: conversationDir,
				scenario: "batch",
			}),
		).rejects.toThrow("serverUrl");
	});

	it("retries transient model failures and suppresses recovered error events", async () => {
		const cwd = await temporaryDirectory("greenfield-host-retry-workspace-");
		const conversationDir = await temporaryDirectory("greenfield-host-retry-conversations-");
		const responses = [assistantMessage("error", "503 service unavailable"), assistantMessage("stop")];
		let callCount = 0;
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			streamFn: () => new RecordedAssistantStream(responses[callCount++] ?? assistantMessage("stop")),
		});
		const backend = new GreenfieldRuntimeHostSessionBackend({
			composition,
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			retrySettings: {
				getRetrySettings: () => ({ enabled: true, maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 }),
				setRetryEnabled() {},
			},
		});
		const runtime = new RuntimeHost({ sessionBackend: backend });
		disposers.push(async () => {
			await runtime.disposeAllSessions();
			await composition.dispose();
		});
		const { sessionId } = await runtime.createSession({ cwd, sessionDir: conversationDir, scenario: "batch" });
		const eventTypes: string[] = [];
		const unsubscribe = runtime.subscribe(sessionId, (event) => eventTypes.push(event.type));

		await runtime.prompt(sessionId, { text: "hello" });
		unsubscribe();

		expect(callCount).toBe(2);
		expect(eventTypes).toContain("retry.start");
		expect(eventTypes).toContain("retry.end");
		expect(eventTypes).not.toContain("error");
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function modelRegistry(): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [MODEL, SECOND_MODEL],
		find: (provider, modelId) =>
			[MODEL, SECOND_MODEL].find((model) => model.provider === provider && model.id === modelId),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const MODEL: Model<Api> = {
	id: "default-model",
	name: "Default Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

const SECOND_MODEL: Model<Api> = {
	...MODEL,
	id: "session-model",
	name: "Session Model",
};

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			if (message.stopReason === "error") {
				this.push({ type: "error", reason: "error", error: message });
				return;
			}
			this.push({ type: "done", reason: "stop", message });
		});
	}
}

function assistantMessage(stopReason: "stop" | "error", errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "test",
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}
