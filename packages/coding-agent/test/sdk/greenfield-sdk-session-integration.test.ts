import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, AssistantMessageEvent, Model } from "@vetta/ai";
import { EventStream } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../../src/adapters/runtime-core/greenfield-model-runtime-adapter.js";
import { createGreenfieldRuntimeComposition } from "../../src/composition/greenfield-runtime-composition.js";
import type { GreenfieldRuntimeComposition } from "../../src/composition/greenfield-runtime-composition-contract.js";
import { bindGreenfieldSdkSessionRuntime } from "../../src/host/sdk-session/runtime-binding.js";
import type { GreenfieldSdkSession } from "../../src/host/sdk-session/runtime-contracts.js";
import { createGreenfieldSdkSession } from "../../src/host/sdk-session/runtime-factory.js";
import { GreenfieldSdkSessionAdapter } from "../../src/host/sdk-session/session-adapter.js";
import { CodingAgentGreenfieldSessionCapabilityHost } from "../../src/host/sdk-session/session-capability-host.js";

describe("Greenfield SDK session integration", () => {
	const temporaryDirectories: string[] = [];
	const compositions: GreenfieldRuntimeComposition[] = [];
	const sdkSessions: GreenfieldSdkSession[] = [];

	afterEach(async () => {
		await Promise.all(sdkSessions.splice(0).map((session) => session.close()));
		await Promise.all(compositions.splice(0).map((composition) => composition.dispose()));
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("runs the SDK core facade through the real Greenfield composition", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-workspace-");
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			cwd: workspace,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			streamFn: () => new RecordedAssistantStream(assistantMessage("Greenfield SDK response")),
		});
		compositions.push(composition);
		const runtimeSession = await composition.backend.create({
			sessionId: "sdk-integration",
			includeAgentSkills: false,
		});
		const capabilities = new CodingAgentGreenfieldSessionCapabilityHost({ readSession: () => runtimeSession });
		const session = new GreenfieldSdkSessionAdapter(bindGreenfieldSdkSessionRuntime(runtimeSession, capabilities));
		const eventTypes: string[] = [];
		session.subscribe((event) => eventTypes.push(event.type));

		await session.prompt("Run through the SDK facade");

		expect(session.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(session.model).toEqual(MODEL);
		expect(session.thinkingLevel).toBe("off");
		expect(eventTypes).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
		await session.close();
	});

	it("creates a real in-memory SDK session without exposing a session file", async () => {
		const workspace = await temporaryDirectory("greenfield-sdk-memory-workspace-");
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "memory", sessionId: "sdk-memory" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(session);

		await session.prompt("Run in memory");

		expect(session.sessionId).toBe("sdk-memory");
		expect(session.sessionFile).toBeUndefined();
		expect(session.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
	});

	it("preserves queued steering and follow-up messages through the Runtime queue port", async () => {
		const workspace = await temporaryDirectory("greenfield-sdk-queue-workspace-");
		let stream: DeferredAssistantStream | undefined;
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "memory", sessionId: "sdk-queue" },
			composition: {
				...factoryComposition(workspace),
				streamFn: () => {
					stream = new DeferredAssistantStream();
					return stream;
				},
			},
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(session);
		const running = session.prompt("running turn");
		await vi.waitFor(() => expect(session.isStreaming).toBe(true));

		await session.steer("queued steering");
		await session.followUp("queued follow-up");
		expect(session.pendingMessageCount).toBe(2);
		expect(session.getSteeringMessages()).toEqual(["queued steering"]);
		expect(session.getFollowUpMessages()).toEqual(["queued follow-up"]);
		expect(session.clearQueue()).toEqual({
			steering: ["queued steering"],
			followUp: ["queued follow-up"],
		});
		expect(session.pendingMessageCount).toBe(0);

		if (!stream) throw new Error("Expected a deferred assistant stream");
		stream.complete(assistantMessage("completed"));
		await running;
	});

	it("retries transient Turn failures and publishes retry events through the SDK subscription", async () => {
		const workspace = await temporaryDirectory("greenfield-sdk-retry-workspace-");
		let streamCalls = 0;
		let retryEnabled = true;
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "memory", sessionId: "sdk-retry" },
			composition: {
				...factoryComposition(workspace),
				streamFn: () => {
					streamCalls += 1;
					return new RecordedAssistantStream(
						streamCalls === 1
							? { ...assistantMessage(""), stopReason: "error", errorMessage: "503 service unavailable" }
							: assistantMessage("retry succeeded"),
					);
				},
			},
			session: { includeAgentSkills: false },
			createCapabilityHost: ({ session: runtimeSession }) =>
				new CodingAgentGreenfieldSessionCapabilityHost({
					readSession: () => runtimeSession,
					settings: {
						setDefaultModelAndProvider: () => undefined,
						setDefaultThinkingLevel: () => undefined,
						setSteeringMode: () => undefined,
						setFollowUpMode: () => undefined,
						getRetryEnabled: () => retryEnabled,
						getRetrySettings: () => ({ enabled: retryEnabled, maxRetries: 1, baseDelayMs: 0 }),
						setRetryEnabled: (enabled) => {
							retryEnabled = enabled;
						},
					},
				}),
		});
		sdkSessions.push(session);
		const retryEvents: string[] = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_start" || event.type === "auto_retry_end") retryEvents.push(event.type);
		});

		await session.prompt("retry this turn");

		expect(streamCalls).toBe(2);
		expect(retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
		expect(session.getLastAssistantText()).toBe("retry succeeded");
	});

	it("creates and resumes a native file session through the SDK storage target", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-factory-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-factory-workspace-");
		const created = await createGreenfieldSdkSession({
			storage: { kind: "file-create", conversationDir, sessionId: "sdk-file" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(created.session);
		await created.session.prompt("Persist this turn");
		const sessionPath = created.session.sessionFile;
		expect(sessionPath).toBeDefined();
		await created.session.close();

		if (!sessionPath) throw new Error("Expected a persisted SDK session path");
		const resumed = await createGreenfieldSdkSession({
			storage: { kind: "file-resume", conversationDir, sessionPath },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(resumed.session);

		expect(resumed.session.sessionId).toBe("sdk-file");
		expect(resumed.session.sessionFile).toBe(sessionPath);
		expect(resumed.session.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		await resumed.session.prompt("Continue after resume");
		expect(resumed.session.messages.map(({ role }) => role)).toEqual(["user", "assistant", "user", "assistant"]);
	});

	it("keeps one SDK facade and its subscriptions across new, switch and fork transitions", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-active-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-active-workspace-");
		const created = await createGreenfieldSdkSession({
			storage: { kind: "file-create", conversationDir, sessionId: "sdk-active-initial" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(created.session);
		const stableFacade = created.session;
		const observedAgentStarts: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "agent_start") observedAgentStarts.push(created.session.sessionId);
		});

		await created.session.prompt("initial prompt");
		const initialPath = created.session.sessionFile;
		if (!initialPath) throw new Error("Expected an initial session path");
		const initialForkMessage = created.session.getUserMessagesForForking()[0];
		if (!initialForkMessage) throw new Error("Expected a user message for forking");

		await expect(created.session.newSession()).resolves.toBe(true);
		expect(created.session).toBe(stableFacade);
		expect(created.session.sessionId).not.toBe("sdk-active-initial");
		expect(created.session.messages).toEqual([]);
		await created.session.prompt("new session prompt");

		await expect(created.session.switchSession(initialPath)).resolves.toBe(true);
		expect(created.session).toBe(stableFacade);
		expect(created.session.sessionId).toBe("sdk-active-initial");
		expect(created.session.getLastAssistantText()).toBe("Greenfield SDK response");

		const fork = await created.session.fork(initialForkMessage.entryId);
		expect(fork).toEqual({ selectedText: "initial prompt", cancelled: false });
		expect(created.session).toBe(stableFacade);
		expect(created.session.sessionId).not.toBe("sdk-active-initial");
		expect(observedAgentStarts).toHaveLength(2);
	});

	it("keeps the current SDK session usable when a switch target is invalid", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-switch-rollback-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-switch-rollback-workspace-");
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "file-create", conversationDir, sessionId: "sdk-switch-source" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(session);

		await expect(session.switchSession(join(conversationDir, "invalid.conversation.jsonl"))).rejects.toThrow(
			"Greenfield session path is invalid",
		);
		expect(session.sessionId).toBe("sdk-switch-source");
		await expect(session.prompt("still usable")).resolves.toBeUndefined();
		expect(session.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
	});

	it("moves Session resources with the active identity and disposes each exactly once", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-resource-transition-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-resource-transition-workspace-");
		const initialized: string[] = [];
		const disposed: string[] = [];
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "file-create", conversationDir, sessionId: "sdk-resource-initial" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
			initializeSession: async ({ session: runtimeSession, source }) => {
				initialized.push(`${source}:${runtimeSession.sessionId}`);
				return {
					id: `resource:${runtimeSession.sessionId}`,
					dispose: () => {
						disposed.push(runtimeSession.sessionId);
					},
				};
			},
		});
		sdkSessions.push(session);

		await session.newSession();
		const activeSessionId = session.sessionId;
		expect(initialized).toEqual(["initial:sdk-resource-initial", `transition:${activeSessionId}`]);
		expect(disposed).toEqual(["sdk-resource-initial"]);

		await session.close();
		expect(disposed).toEqual(["sdk-resource-initial", activeSessionId]);
	});

	it("rolls back the SDK identity and target resource when transition finalization fails", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-resource-rollback-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-resource-rollback-workspace-");
		const disposed: string[] = [];
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "file-create", conversationDir, sessionId: "sdk-resource-source" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
			initializeSession: async ({ session: runtimeSession }) => ({
				id: `resource:${runtimeSession.sessionId}`,
				dispose: () => {
					disposed.push(runtimeSession.sessionId);
				},
			}),
			transitionLifecycle: {
				after: async () => {
					throw new Error("SDK binding finalization failed");
				},
			},
		});
		sdkSessions.push(session);

		await expect(session.newSession()).rejects.toThrow("SDK binding finalization failed");

		expect(session.sessionId).toBe("sdk-resource-source");
		expect(disposed).toHaveLength(1);
		expect(disposed[0]).not.toBe("sdk-resource-source");
		await expect(session.prompt("source remains usable")).resolves.toBeUndefined();
	});

	it("rolls back the composition when SDK session initialization fails", async () => {
		const conversationDir = await temporaryDirectory("greenfield-sdk-rollback-conversations-");
		const workspace = await temporaryDirectory("greenfield-sdk-rollback-workspace-");
		await expect(
			createGreenfieldSdkSession({
				storage: { kind: "file-create", conversationDir, sessionId: "sdk-rollback" },
				composition: {
					...factoryComposition(workspace),
					resolveSystemPromptOptions: () => {
						throw new Error("system prompt initialization failed");
					},
				},
				session: { includeAgentSkills: false },
			}),
		).rejects.toThrow("system prompt initialization failed");

		const recovered = await createGreenfieldSdkSession({
			storage: { kind: "file-create", conversationDir, sessionId: "sdk-rollback" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
		});
		sdkSessions.push(recovered.session);
		expect(recovered.session.sessionId).toBe("sdk-rollback");
	});

	it("owns product resources before and after the Runtime Session lifecycle", async () => {
		const workspace = await temporaryDirectory("greenfield-sdk-owned-resource-workspace-");
		const disposed: string[] = [];
		const { session } = await createGreenfieldSdkSession({
			storage: { kind: "memory", sessionId: "sdk-owned-resources" },
			composition: factoryComposition(workspace),
			session: { includeAgentSkills: false },
			ownedResources: [
				{
					id: "host-resource",
					dispose: () => {
						disposed.push("host");
					},
				},
			],
			initializeSession: async () => ({
				id: "session-resource",
				dispose: () => {
					disposed.push("session");
				},
			}),
		});
		sdkSessions.push(session);

		await session.close();

		expect(disposed).toEqual(["session", "host"]);
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		temporaryDirectories.push(directory);
		return directory;
	}
});

function factoryComposition(workspace: string) {
	return {
		cwd: workspace,
		modelRegistry: modelRegistry(),
		initialModel: MODEL,
		initialThinkingLevel: "off" as const,
		enableSubagents: false,
		activation: { mode: "explicit" as const, toolNames: [] },
		streamFn: () => new RecordedAssistantStream(assistantMessage("Greenfield SDK response")),
	};
}

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
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				this.push({ type: "error", reason: message.stopReason, error: message });
				return;
			}
			this.push({ type: "done", reason: message.stopReason, message });
		});
	}
}

class DeferredAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
	}

	complete(message: AssistantMessage): void {
		this.push({ type: "done", reason: "stop", message });
	}
}

function modelRegistry(): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [MODEL],
		find: (provider, modelId) => (provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
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

const MODEL: Model<Api> = {
	id: "sdk-recorded-model",
	name: "SDK Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
