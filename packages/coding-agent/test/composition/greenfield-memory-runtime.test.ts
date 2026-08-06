import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import { FileConversationRepository } from "@vetta/runtime-storage/conversation";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createCodingAgentRuntimeComposition as createGreenfieldRuntimeComposition,
	type CodingAgentRuntimeComposition as GreenfieldRuntimeComposition,
} from "../../src/composition/index.js";
import { type CodingAgentMemoryFlushInput, CodingAgentMemoryRolloverOrchestrator } from "../../src/memory/index.js";
import type { CodingAgentRuntimeModelSource } from "../../src/public-api/host-services.js";

const temporaryRoots: string[] = [];
const compositions: GreenfieldRuntimeComposition[] = [];

afterEach(async () => {
	for (const composition of compositions.splice(0).reverse()) await composition.dispose();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Greenfield CLI memory runtime", () => {
	it("keeps the prompt snapshot frozen while exposing the existing memory tool and completed-turn journal", async () => {
		const workspace = await temporaryRoot("greenfield-memory-workspace-");
		const conversations = await temporaryRoot("greenfield-memory-conversations-");
		const memoryFile = join(workspace, "MEMORY.md");
		await writeFile(memoryFile, "original durable fact", "utf8");
		const calls: Array<{ readonly systemPrompt: string; readonly tools: readonly string[] }> = [];
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "memory-1",
						name: "memory",
						arguments: {
							description: "Remember the selected editor",
							action: "add",
							content: "The user prefers Neovim.",
						},
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "Memory saved." }]),
		];
		let responseIndex = 0;
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: workspace,
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			resolveSystemPromptOptions: () => ({
				customPrompt: "Memory-enabled Coding Agent",
				scenario: "im-claw",
			}),
			streamFn: (_model, context) => {
				calls.push({
					systemPrompt: context.systemPrompt ?? "",
					tools: (context.tools ?? []).map(({ name }) => name),
				});
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "memory-session",
			cwd: workspace,
			memoryMode: true,
			memoryFile,
			memoryCharLimit: 4_000,
		});

		const result = await session.prompt({ text: "Remember my editor preference" });

		expect(result.status).toBe("completed");
		expect(calls).toHaveLength(2);
		expect(calls[0]?.tools).toEqual(["memory"]);
		expect(calls[1]?.tools).toEqual(["memory"]);
		expect(calls[0]?.systemPrompt).toContain("original durable fact");
		expect(calls[1]?.systemPrompt).toContain("original durable fact");
		expect(calls[1]?.systemPrompt).not.toContain("The user prefers Neovim.");
		expect(await readFile(memoryFile, "utf8")).toContain("The user prefers Neovim.");
		expect(await readFile(join(workspace, "JOURNAL.md"), "utf8")).toContain("Memory saved.");
		await session.dispose();
	});

	it("does not install memory prompt, tool or journal when memory-mode is disabled", async () => {
		const workspace = await temporaryRoot("greenfield-non-memory-workspace-");
		const conversations = await temporaryRoot("greenfield-non-memory-conversations-");
		const calls: Array<{ readonly systemPrompt: string; readonly tools: readonly string[] }> = [];
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: workspace,
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			resolveSystemPromptOptions: () => ({
				customPrompt: "Plain Coding Agent",
				scenario: "cli",
			}),
			streamFn: (_model, context) => {
				calls.push({
					systemPrompt: context.systemPrompt ?? "",
					tools: (context.tools ?? []).map(({ name }) => name),
				});
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "Done." }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({ sessionId: "plain-session", cwd: workspace });

		await session.prompt({ text: "Do not enable memory" });

		expect(calls[0]?.tools).toEqual([]);
		expect(calls[0]?.systemPrompt).not.toContain("# Persistent Memory");
		await expect(composition.flushMemory(session.sessionId)).resolves.toBe(0);
		await expect(readFile(join(workspace, "JOURNAL.md"), "utf8")).rejects.toThrow();
		await session.dispose();
	});

	it("flushes the current active context on demand through the product composition boundary", async () => {
		const workspace = await temporaryRoot("greenfield-memory-flush-workspace-");
		const conversations = await temporaryRoot("greenfield-memory-flush-conversations-");
		const memoryFile = join(workspace, "MEMORY.md");
		const flushMemory = vi.fn(
			async (_input: CodingAgentMemoryFlushInput & { readonly memoryFile: string; readonly limit: number }) => [
				"saved fact",
			],
		);
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: workspace,
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			createMemoryRolloverRuntime: (runtimeOptions) =>
				new CodingAgentMemoryRolloverOrchestrator({ ...runtimeOptions, flushMemory }),
			resolveSystemPromptOptions: () => ({
				customPrompt: "Memory flush Coding Agent",
				scenario: "im-claw",
			}),
			streamFn: () => new RecordedAssistantStream(assistantMessage([{ type: "text", text: "Short response." }])),
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "memory-flush-session",
			cwd: workspace,
			memoryMode: true,
			memoryFile,
		});
		await session.prompt({ text: "Short request" });

		const written = await composition.flushMemory(session.sessionId);

		expect(written).toBe(1);
		expect(flushMemory).toHaveBeenCalledOnce();
		expect(flushMemory.mock.calls[0]?.[0]?.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(flushMemory.mock.calls[0]?.[0]).toMatchObject({
			memoryFile,
			limit: 4_000,
			model: MODEL,
			apiKey: "test-key",
		});
		await session.dispose();
	});

	it("flushes and continues the same turn in a new conversation at the legacy memory threshold", async () => {
		const workspace = await temporaryRoot("greenfield-memory-rollover-workspace-");
		const conversations = await temporaryRoot("greenfield-memory-rollover-conversations-");
		const memoryFile = join(workspace, "MEMORY.md");
		await writeFile(memoryFile, "seed memory", "utf8");
		const flushMemory = vi.fn(
			async (_input: CodingAgentMemoryFlushInput & { readonly memoryFile: string; readonly limit: number }) => [],
		);
		const responses = [
			assistantMessage([{ type: "text", text: "First response." }], "stop", 1_000),
			assistantMessage([{ type: "text", text: "Second response." }], "stop", 6_000),
		];
		let responseIndex = 0;
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: workspace,
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			resolveCompactionSettings: () => ({
				enabled: true,
				reserveTokens: 10,
				minFreePercent: 20,
				keepRecentTokens: 1,
			}),
			generateCompaction: async (preparation) => ({
				summary: "memory rollover summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
			createMemoryRolloverRuntime: (runtimeOptions) =>
				new CodingAgentMemoryRolloverOrchestrator({ ...runtimeOptions, flushMemory }),
			resolveSystemPromptOptions: () => ({
				customPrompt: "Memory rollover Coding Agent",
				scenario: "im-claw",
			}),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "memory-rollover-source",
			cwd: workspace,
			memoryMode: true,
			memoryFile,
		});

		await session.prompt({ text: "First request" });
		const result = await session.prompt({ text: "Second request" });

		expect(result.status).toBe("completed");
		if (result.status === "queued") throw new Error("Memory rollover prompt was unexpectedly queued");
		expect(session.sessionId).not.toBe("memory-rollover-source");
		expect(result.sessionId).toBe(session.sessionId);
		expect(flushMemory).toHaveBeenCalledOnce();
		expect(flushMemory.mock.calls[0]?.[0]?.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		const reader = new FileConversationRepository({ rootDir: conversations });
		const source = await reader.load("memory-rollover-source");
		const target = await reader.load(session.sessionId);
		expect(source.events.at(-1)).toMatchObject({
			type: "turn.transferred",
			targetSessionId: session.sessionId,
			reason: "memory-rollover",
		});
		expect(target.events.map(({ type }) => type)).toEqual(["turn.continued", "turn.completed"]);
		await reader.close();
		await expect(composition.flushMemory("memory-rollover-source")).resolves.toBe(0);
		await expect(composition.flushMemory(session.sessionId)).resolves.toBe(0);
		expect(flushMemory).toHaveBeenCalledTimes(2);
		const journal = await readFile(join(workspace, "JOURNAL.md"), "utf8");
		expect(journal).toContain("First response.");
		expect(journal).toContain("Second response.");
		expect(journal).toContain("## Rollover");
		expect(journal).toContain("memory rollover summary");
		await session.dispose();
	});
});

type SuccessfulAssistantMessage = AssistantMessage & { readonly stopReason: "length" | "stop" | "toolUse" };

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: SuccessfulAssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			this.push({ type: "done", reason: message.stopReason, message });
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

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: "length" | "stop" | "toolUse" = "stop",
	totalTokens = 2,
): SuccessfulAssistantMessage {
	return {
		role: "assistant",
		content,
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: totalTokens - 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

async function temporaryRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
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
