import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	createPromptCacheDiagnostics,
	EventStream,
	type Message,
	type Model,
} from "@vetta/ai";
import type { RuntimeSnapshotAcquireContext } from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompactionPreparation } from "../../src/compaction/index.js";
import type { CodingAgentRuntimeComposition } from "../../src/composition/index.js";
import { CodingAgentTodoRuntime } from "../../src/features/todo/todo-runtime.js";
import {
	type EcosystemHookEvent,
	emptyHookDispatchOutcome,
	type HookDispatchOutcome,
} from "../../src/public-api/hooks.js";
import type {
	CodingAgentPluginRuntimeSource,
	CodingAgentRuntimeModelSource,
} from "../../src/public-api/host-services.js";
import { createCodingAgentRuntimeComposition } from "../fixtures/conversation-persistence.js";

describe("Coding Agent continuation orchestration", () => {
	const temporaryDirectories: string[] = [];
	const compositions: CodingAgentRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) {
			await composition.dispose();
		}
		for (const directory of temporaryDirectories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("manually compacts through the admitted Runtime capability and preserves the transient prefix afterwards", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "manual-pinned-runtime-"));
		temporaryDirectories.push(conversationDir);
		const requests: Context[] = [];
		const afterCommit = vi.fn(async () => undefined);
		const manualRelease = vi.fn();
		const generation = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "PRIVATE_SUMMARY",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: [] },
			resolveCompactionSettings: () => ({
				enabled: false,
				keepRecentTokens: 1,
				reserveTokens: 20,
				minFreePercent: 20,
			}),
			generateCompaction: generation,
			createCompactionExtensionRuntime: () => ({
				beforeCompaction: async () => {
					throw new Error("Manual compaction used an unbound extension");
				},
				afterCompaction: async () => {
					throw new Error("Manual commit used an unbound extension");
				},
				bindForTurn: (context) => ({
					beforeCompaction: async () => undefined,
					afterCompaction: afterCommit,
					releaseTurnBinding: () => {
						if (context.reason === "manual_compaction") manualRelease();
					},
				}),
			}),
			streamFn: (_model, context) => {
				requests.push(structuredClone(context));
				return new RecordedAssistantStream(assistantMessage("private answer"));
			},
		});
		compositions.push(composition);
		const bindPinnedModelContext = vi.fn((_context: RuntimeSnapshotAcquireContext) => ({
			id: "shared",
			records: [{ type: "public", content: "PUBLIC_PIN", modelVisible: true, timestamp: 1 }],
		}));
		const session = await composition.createSession({
			sessionId: "manual-member",
			cwd: conversationDir,
			bindPinnedModelContext,
		});
		try {
			await session.prompt({ text: "private task ".repeat(40) });
			await session.prompt({ text: "current task" });
			await expect(session.compact()).resolves.toMatchObject({ summary: "PRIVATE_SUMMARY" });
			expect(generation).toHaveBeenCalledOnce();
			expect(JSON.stringify(generation.mock.calls[0])).not.toContain("PUBLIC_PIN");
			expect(JSON.stringify(generation.mock.calls[0])).toContain("private task");
			expect(afterCommit).toHaveBeenCalledOnce();
			expect(manualRelease).toHaveBeenCalledOnce();
			expect(
				bindPinnedModelContext.mock.calls.filter(([context]) => context.reason === "manual_compaction"),
			).toHaveLength(1);
			await session.prompt({ text: "after compact" });
			expect(JSON.stringify(requests.at(-1))).toContain("PUBLIC_PIN");
			expect(JSON.stringify(requests.at(-1))).toContain("PRIVATE_SUMMARY");
			expect(JSON.stringify(await session.readMessages())).not.toContain("PUBLIC_PIN");
		} finally {
			await session.dispose();
		}
	});

	it("keeps the pinned prefix transient across real Runtime model calls and distinct member sessions", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "pinned-context-runtime-"));
		temporaryDirectories.push(conversationDir);
		const calls: { sessionId?: string; promptCacheKey?: string; context: Context }[] = [];
		const countBySession = new Map<string, number>();
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: [] },
			streamFn: (_model, context, options) => {
				calls.push({
					sessionId: options?.sessionId,
					promptCacheKey: options?.promptCacheKey,
					context: structuredClone(context),
				});
				const id = options?.sessionId ?? "unknown";
				const count = countBySession.get(id) ?? 0;
				countBySession.set(id, count + 1);
				return new RecordedAssistantStream(
					assistantMessage(count === 0 ? "" : "done", count === 0 ? "length" : "stop"),
				);
			},
		});
		compositions.push(composition);
		let publicText = "public generation one";
		const bindPinnedModelContext = vi.fn((_context: RuntimeSnapshotAcquireContext) => ({
			id: publicText,
			records: [{ type: "shared.context", content: publicText, modelVisible: true, timestamp: 1 }],
		}));
		for (const id of ["member-one", "member-two"]) {
			const session = await composition.createSession({
				sessionId: id,
				cwd: conversationDir,
				promptCacheKey: "shared-team-cache",
				systemPromptCachePrefixAddon: "Shared Team roster and collaboration contract",
				systemPromptVolatileAddon: `Trusted identity: ${id}`,
				bindPinnedModelContext,
			});
			try {
				await session.prompt({ text: "start" });
				expect(
					(await session.readMessages()).some((message) => JSON.stringify(message).includes("public generation")),
				).toBe(false);
				if (id === "member-two") {
					publicText = "public generation two";
					await session.prompt({ text: "next" });
				}
			} finally {
				await session.dispose();
			}
		}
		const turnBindings = bindPinnedModelContext.mock.calls
			.map(([context]) => context)
			.filter((context) => context.reason === "turn");
		expect(turnBindings).toHaveLength(3);
		expect(new Set(turnBindings.map((context) => context.operationId)).size).toBe(3);
		expect(calls).toHaveLength(5);
		expect(new Set(calls.map((call) => call.sessionId)).size).toBe(2);
		expect(calls.every((call) => call.promptCacheKey === "shared-team-cache")).toBe(true);
		const firstMemberFrame = calls[0]?.context;
		const secondMemberFrame = calls[2]?.context;
		if (!firstMemberFrame || !secondMemberFrame) throw new Error("Expected both member Provider frames");
		expect(firstMemberFrame.systemPrompt).not.toBe(secondMemberFrame.systemPrompt);
		expect(firstMemberFrame.systemPromptStableLength).toBeGreaterThan(0);
		expect(firstMemberFrame.systemPromptStableLength).toBe(secondMemberFrame.systemPromptStableLength);
		const stableLength = firstMemberFrame.systemPromptStableLength ?? 0;
		expect(firstMemberFrame.systemPrompt?.slice(0, stableLength)).toBe(
			secondMemberFrame.systemPrompt?.slice(0, stableLength),
		);
		expect(firstMemberFrame.systemPrompt?.slice(0, stableLength)).toContain("Shared Team roster");
		expect(firstMemberFrame.systemPrompt?.slice(stableLength)).toContain("Trusted identity: member-one");
		expect(secondMemberFrame.systemPrompt?.slice(stableLength)).toContain("Trusted identity: member-two");
		const firstCache = createPromptCacheDiagnostics(firstMemberFrame);
		const secondCache = createPromptCacheDiagnostics(secondMemberFrame);
		expect(firstCache.cachePrefixHash).toBe(secondCache.cachePrefixHash);
		expect(firstCache.stableSystemPromptHash).toBe(secondCache.stableSystemPromptHash);
		expect(firstCache.volatileSystemPromptHash).not.toBe(secondCache.volatileSystemPromptHash);
		for (const call of calls.slice(0, 4)) {
			expect(call.context.messages[0]).toMatchObject({ role: "user", content: "public generation one" });
			expect(
				call.context.messages.filter((message) => JSON.stringify(message).includes("public generation one")),
			).toHaveLength(1);
			expect(call.context.systemPrompt).toContain("Trusted identity:");
		}
		expect(calls[4]?.context.messages[0]).toMatchObject({ content: "public generation two" });
		expect(JSON.stringify(calls[4])).not.toContain("public generation one");
	});

	it("runs Todo, Plugin and Stop Hook continuations in the established order", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "continuation-orchestration-"));
		temporaryDirectories.push(conversationDir);
		const todoRuntime = new CodingAgentTodoRuntime();
		const pluginInvocations: string[] = [];
		const stopInvocations: Array<string | null> = [];
		const modelCalls: Array<readonly Message[]> = [];
		const pluginRuntime: CodingAgentPluginRuntimeSource = {
			readAgentPlugins: () => ({
				continuationContributions: [
					{
						pluginId: "plugin-a",
						id: "continue",
						handlerId: "continue-handler",
						context: { conversation: "messages" },
					},
				],
			}),
			invokeContinuation: async (invocation) => {
				pluginInvocations.push(`${invocation.pluginId}:${invocation.providerId}`);
				return {
					value: { text: "plugin continuation", idempotencyKey: "once" },
					effects: [],
				};
			},
		};
		let stopCount = 0;
		const stopHook = vi.fn(async (lastAssistantMessage: string | null) => {
			stopInvocations.push(lastAssistantMessage);
			stopCount += 1;
			return stopCount === 1 ? ["stop hook continuation"] : [];
		});
		const responses = [
			assistantMessage("initial response"),
			assistantMessage("todo response"),
			assistantMessage("plugin response"),
			assistantMessage("hook response"),
		];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: [] },
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "cli",
			}),
			createPluginRuntime: () => pluginRuntime,
			createTodoRuntime: () => todoRuntime,
			additionalHookAdapterFactories: [
				async () => ({
					id: "test-stop-hook",
					supports: (event) => event.eventName === "Stop",
					dispatch: async (event) => stopHookOutcome(event, stopHook),
				}),
			],
			streamFn: (_model, context) => {
				modelCalls.push([...context.messages]);
				if (responseIndex === 1) {
					todoRuntime.update(1, "done");
				}
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const session = await composition.createSession({
			sessionId: "continuation-session",
			cwd: "C:\\workspace",
		});
		// 只有锁定（scene）列表才驱动续跑，普通 Todo 不再产生提醒。
		todoRuntime.initializeSceneTodoItems(["Finish implementation"]);
		await todoRuntime.flush();

		await session.prompt({ text: "start" });

		expect(modelCalls).toHaveLength(4);
		const userTexts = (await session.readMessages())
			.filter((message): message is Extract<Message, { role: "user" }> => message.role === "user")
			.map(messageText);
		expect(userTexts).toHaveLength(4);
		expect(userTexts[0]).toBe("start");
		expect(userTexts[1]).toContain("[ephemeral:todo]");
		expect(userTexts[1]).toContain("#1 Finish implementation");
		expect(userTexts[2]).toBe("plugin continuation");
		expect(userTexts[3]).toBe("stop hook continuation");
		expect(pluginInvocations).toEqual(["plugin-a:continue", "plugin-a:continue", "plugin-a:continue"]);
		expect(stopInvocations).toEqual(["plugin response", "hook response"]);
		expect((await session.readMessages()).map(({ role }) => role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		await session.dispose();
	});

	it("automatically resumes a response that ended because of the model length limit", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "length-continuation-"));
		temporaryDirectories.push(conversationDir);
		const modelCalls: Array<readonly Message[]> = [];
		const responses = [assistantMessage("", "length"), assistantMessage("completed response")];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: [] },
			streamFn: (_model, context) => {
				modelCalls.push([...context.messages]);
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const session = await composition.createSession({ sessionId: "length-session", cwd: "C:\\workspace" });

		await session.prompt({ text: "start" });

		expect(modelCalls).toHaveLength(2);
		expect(messageText(modelCalls[1]?.at(-1) as Extract<Message, { role: "user" }>)).toContain(
			"Continue the response from where you stopped",
		);
		expect((await session.readMessages()).filter((message) => message.role === "assistant")).toHaveLength(2);
		expect((await session.readMessages()).at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
		await session.dispose();
	});
});

async function stopHookOutcome(
	event: EcosystemHookEvent,
	stopHook: (message: string | null) => Promise<readonly string[]>,
): Promise<HookDispatchOutcome> {
	if (event.eventName !== "Stop") return emptyHookDispatchOutcome();
	const continuationFragments = await stopHook(event.lastAssistantMessage);
	return {
		...emptyHookDispatchOutcome(),
		shouldBlock: continuationFragments.length > 0,
		continuationFragments: [...continuationFragments],
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
			this.push({ type: "done", reason: successfulStopReason(message), message });
		});
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

function assistantMessage(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
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
		stopReason,
		timestamp: 2,
	};
}

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
}

function messageText(message: Extract<Message, { role: "user" }>): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
		.map(({ text }) => text)
		.join("");
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
