import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@vetta/ai";
import {
	CodingAgentActiveSessionHost,
	type CodingAgentRuntimeComposition,
	type CodingAgentSessionTransitionLifecycle,
	createCodingAgentRuntimeComposition,
} from "@vetta/coding-agent/composition";
import { type EcosystemHookEvent, emptyHookDispatchOutcome, type HookDispatchOutcome } from "@vetta/coding-agent/hooks";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import type { RuntimeSession, RuntimeSessionCatalog } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";

const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

describe("Session-local Ecosystem Hook Runtime contract", { timeout: INTEGRATION_TEST_TIMEOUT_MS }, () => {
	const temporaryDirectories: string[] = [];
	const compositions: CodingAgentRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) {
			await composition.dispose();
		}
		for (const directory of temporaryDirectories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	}, INTEGRATION_TEST_TIMEOUT_MS);

	it("shares one runtime across prompt, final tools, stop, persistence, resume and dispose", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "runtime-hooks-"));
		temporaryDirectories.push(conversationDir);
		const hookEvents: EcosystemHookEvent[] = [];
		const modelCalls: Array<readonly Message[]> = [];
		const responses = [
			assistantToolCall("current_time", {}),
			assistantText("first complete"),
			assistantText("second complete"),
			assistantText("resumed complete"),
		];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: ["current_time"] },
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "cli",
			}),
			additionalHookAdapterFactories: [
				async () => ({
					id: "runtime-lifecycle-test",
					supports: (event) =>
						event.eventName === "SessionStart" ||
						event.eventName === "SessionEnd" ||
						event.eventName === "UserPromptSubmit" ||
						event.eventName === "PreToolUse" ||
						event.eventName === "PostToolUse" ||
						event.eventName === "Stop",
					async dispatch(event) {
						hookEvents.push(event);
						return hookOutcome(event);
					},
				}),
			],
			streamFn: (_model, context) => {
				modelCalls.push([...context.messages]);
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const createOptions = {
			sessionId: "hook-session",
			cwd: "C:\\workspace",
		};
		const session = await composition.backend.create(createOptions);

		await session.prompt({ text: "first prompt" });
		expect(messageTexts(modelCalls[0])).toEqual(
			expect.arrayContaining(["session context: startup", "prompt context: first prompt", "first prompt"]),
		);
		expect(messageTexts(modelCalls[1])).not.toContain("pre-tool context");
		expect(messageTexts(modelCalls[1])).not.toContain("post-tool context");

		await session.prompt({ text: "second prompt" });
		expect(messageTexts(modelCalls[2])).toEqual(
			expect.arrayContaining(["pre-tool context", "post-tool context", "prompt context: second prompt"]),
		);
		await session.dispose();

		const resumed = await composition.backend.resume(createOptions);
		await resumed.prompt({ text: "resumed prompt" });
		expect(messageTexts(modelCalls[3])).toEqual(
			expect.arrayContaining([
				"pre-tool context",
				"post-tool context",
				"session context: resume",
				"prompt context: resumed prompt",
			]),
		);
		await resumed.dispose();

		expect(
			hookEvents
				.filter((event) => event.eventName === "SessionStart")
				.map((event) => (event.eventName === "SessionStart" ? event.source : undefined)),
		).toEqual(["startup", "resume"]);
		expect(
			hookEvents
				.filter((event) => event.eventName === "SessionEnd")
				.map((event) => (event.eventName === "SessionEnd" ? event.cause : undefined)),
		).toEqual(["dispose", "dispose"]);
		expect(
			hookEvents
				.filter((event) => event.eventName === "PreToolUse" || event.eventName === "PostToolUse")
				.map((event) => ({
					eventName: event.eventName,
					toolName:
						event.eventName === "PreToolUse" || event.eventName === "PostToolUse"
							? event.tool.hostName
							: undefined,
				})),
		).toEqual([
			{ eventName: "PreToolUse", toolName: "current_time" },
			{ eventName: "PostToolUse", toolName: "current_time" },
		]);
		expect(hookEvents.filter((event) => event.eventName === "Stop")).toHaveLength(3);
	});

	it("preserves historical SessionEnd causes and target SessionStart sources across replacements", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "runtime-hook-transitions-"));
		temporaryDirectories.push(conversationDir);
		const hookEvents: EcosystemHookEvent[] = [];
		const composition = await createLifecycleComposition(conversationDir, hookEvents);
		compositions.push(composition);
		const source = await composition.backend.create({ sessionId: "lifecycle-source", cwd: conversationDir });
		const sourcePath = source.createCoreAssembly().lifecycle.sessionPath;
		if (!sourcePath) throw new Error("Lifecycle source is not persisted");
		const sessionIds = ["lifecycle-new"];
		const host = createActiveSessionHost(composition, source, conversationDir, () => {
			const sessionId = sessionIds.shift();
			if (!sessionId) throw new Error("Missing lifecycle test session id");
			return sessionId;
		});

		await host.readSession().prompt({ text: "source prompt" });
		await host.newSession();
		await host.readSession().prompt({ text: "new prompt" });
		await host.switchSession(sourcePath);
		await host.readSession().prompt({ text: "resumed prompt" });
		const forkEntry = host
			.readSession()
			.createCoreAssembly()
			.historyReader.readHistory()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		if (!forkEntry || forkEntry.type !== "message" || !forkEntry.entryId) {
			throw new Error("Missing user entry for lifecycle fork");
		}
		await host.fork(forkEntry.entryId);
		await host.readSession().prompt({ text: "fork prompt" });
		await host.dispose();

		expect(sessionLifecycleEvents(hookEvents)).toEqual([
			{ eventName: "SessionStart", sessionId: "lifecycle-source", detail: "startup" },
			{ eventName: "SessionEnd", sessionId: "lifecycle-source", detail: "new_session" },
			{ eventName: "SessionStart", sessionId: "lifecycle-new", detail: "clear" },
			{ eventName: "SessionEnd", sessionId: "lifecycle-new", detail: "switch_session" },
			{ eventName: "SessionStart", sessionId: "lifecycle-source", detail: "resume" },
			{ eventName: "SessionEnd", sessionId: "lifecycle-source", detail: "fork_session" },
			{ eventName: "SessionStart", sessionId: expect.any(String), detail: "clear" },
			{ eventName: "SessionEnd", sessionId: expect.any(String), detail: "dispose" },
		]);
	});

	it("reactivates only the source hooks and removes the uncommitted target after rollback", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "runtime-hook-rollback-"));
		temporaryDirectories.push(conversationDir);
		const hookEvents: EcosystemHookEvent[] = [];
		const composition = await createLifecycleComposition(conversationDir, hookEvents);
		compositions.push(composition);
		const source = await composition.backend.create({ sessionId: "rollback-source", cwd: conversationDir });
		const targetId = "rollback-target";
		const targetPath = sessionPath(conversationDir, targetId);
		const host = createActiveSessionHost(composition, source, conversationDir, () => targetId, {
			after: async () => {
				throw new Error("after transition failed");
			},
		});

		await host.readSession().prompt({ text: "before rollback" });
		await expect(host.newSession()).rejects.toThrow("after transition failed");
		await expect(access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
		await host.readSession().prompt({ text: "after rollback" });
		await host.dispose();

		expect(sessionLifecycleEvents(hookEvents)).toEqual([
			{ eventName: "SessionStart", sessionId: "rollback-source", detail: "startup" },
			{ eventName: "SessionEnd", sessionId: "rollback-source", detail: "new_session" },
			{ eventName: "SessionStart", sessionId: "rollback-source", detail: "resume" },
			{ eventName: "SessionEnd", sessionId: "rollback-source", detail: "dispose" },
		]);
	});
});

async function createLifecycleComposition(
	conversationDir: string,
	hookEvents: EcosystemHookEvent[],
): Promise<CodingAgentRuntimeComposition> {
	return createCodingAgentRuntimeComposition({
		conversationDir,
		modelRegistry: modelRegistry(),
		initialModel: MODEL,
		initialThinkingLevel: "off",
		activation: { mode: "explicit", toolNames: [] },
		resolveSystemPromptOptions: () => ({ customPrompt: "Base prompt", scenario: "cli" }),
		additionalHookAdapterFactories: [
			async () => ({
				id: "runtime-transition-lifecycle-test",
				supports: (event) => event.eventName === "SessionStart" || event.eventName === "SessionEnd",
				async dispatch(event) {
					hookEvents.push(event);
					return emptyHookDispatchOutcome();
				},
			}),
		],
		streamFn: () => new RecordedAssistantStream(assistantText("lifecycle response")),
	});
}

function createActiveSessionHost(
	runtime: CodingAgentRuntimeComposition,
	initialSession: RuntimeSession,
	conversationDir: string,
	createSessionId: () => string,
	lifecycle: CodingAgentSessionTransitionLifecycle | undefined = undefined,
): CodingAgentActiveSessionHost {
	return new CodingAgentActiveSessionHost({
		runtime,
		initialSession,
		sessionOptions: { cwd: conversationDir },
		conversationDir,
		sessionCatalog: sessionCatalog(),
		createSessionId,
		resolveSessionId: (path) => {
			const encoded = path.match(/([^\\/]+)\.conversation\.jsonl$/u)?.[1];
			return encoded ? Buffer.from(encoded, "base64url").toString("utf8") : undefined;
		},
		lifecycle,
	});
}

function sessionCatalog(): RuntimeSessionCatalog {
	return {
		ownsSession: async (path) => {
			try {
				await access(path);
				return true;
			} catch {
				return false;
			}
		},
		listProjects: async () => [],
		listSessions: async () => [],
		renameSession: async () => {},
		deleteSessionArtifacts: async (path) => rm(path, { force: true }),
	};
}

function sessionPath(root: string, sessionId: string): string {
	return join(root, `${Buffer.from(sessionId, "utf8").toString("base64url")}.conversation.jsonl`);
}

function sessionLifecycleEvents(
	events: readonly EcosystemHookEvent[],
): Array<{ eventName: "SessionStart" | "SessionEnd"; sessionId: string; detail: string }> {
	const observations: Array<{
		eventName: "SessionStart" | "SessionEnd";
		sessionId: string;
		detail: string;
	}> = [];
	for (const event of events) {
		if (event.eventName === "SessionStart") {
			observations.push({ eventName: event.eventName, sessionId: event.sessionId, detail: event.source });
		}
		if (event.eventName === "SessionEnd") {
			observations.push({ eventName: event.eventName, sessionId: event.sessionId, detail: event.cause });
		}
	}
	return observations;
}

function hookOutcome(event: EcosystemHookEvent): HookDispatchOutcome {
	if (event.eventName === "SessionStart") {
		return outcome({ additionalContexts: [`session context: ${event.source}`] });
	}
	if (event.eventName === "UserPromptSubmit") {
		return outcome({ additionalContexts: [`prompt context: ${event.prompt}`] });
	}
	if (event.eventName === "PreToolUse") {
		return outcome({ additionalContexts: ["pre-tool context"] });
	}
	if (event.eventName === "PostToolUse") {
		return outcome({ additionalContexts: ["post-tool context"] });
	}
	return emptyHookDispatchOutcome();
}

function outcome(overrides: Partial<HookDispatchOutcome>): HookDispatchOutcome {
	return { ...emptyHookDispatchOutcome(), ...overrides };
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
			this.push({ type: "done", reason: successfulStopReason(message), message });
		});
	}
}

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
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

function assistantToolCall(name: string, args: Readonly<Record<string, unknown>>): AssistantMessage {
	return assistantMessage([{ type: "toolCall", id: "call-1", name, arguments: args }], "toolUse");
}

function assistantText(text: string): AssistantMessage {
	return assistantMessage([{ type: "text", text }], "stop");
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
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
		stopReason,
		timestamp: 2,
	};
}

function messageTexts(messages: readonly Message[] | undefined): string[] {
	return (messages ?? []).flatMap((message) => {
		if (typeof message.content === "string") return [message.content];
		return message.content
			.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
			.map(({ text }) => text);
	});
}

const MODEL: Model<Api> = {
	id: "recorded-model",
	name: "Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
