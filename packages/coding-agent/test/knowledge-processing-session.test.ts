import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../src/adapters/runtime-core/greenfield-model-runtime-adapter.js";
import { createKnowledgeProcessingSessionFactory } from "../src/composition/index.js";
import type { KnowledgeProcessingSessionFactoryOptions } from "../src/composition/knowledge-processing-session.js";
import {
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition,
} from "../src/composition/runtime-composition.js";

describe("Knowledge processing session", () => {
	const directories: string[] = [];

	afterEach(async () => {
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("preserves model refresh, locked todos, injected writer, usage, and disposal", async () => {
		const cwd = await createTemporaryDirectory("greenfield-kb-cwd-");
		const conversationDir = await createTemporaryDirectory("greenfield-kb-sessions-");
		const knowledgeDirectory = await createTemporaryDirectory("greenfield-kb-root-");
		const registryEvents: string[] = [];
		const registry = modelRegistry(registryEvents);
		const observedFrames: string[] = [];
		const observedModels: Model<Api>[] = [];
		const observedReasoning: unknown[] = [];
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "todo-clear",
						name: "todo",
						arguments: { description: "Replace the plan", action: "clear" },
					},
					{
						type: "toolCall",
						id: "write-page",
						name: "kb_write_page",
						arguments: {
							description: "Write the page",
							path: "topic/page.md",
							source: "manual",
							source_path: "manual/source.md",
							source_hash: "source-hash",
							tags: ["topic"],
							title: "Page",
							summary: "Summary",
							body: "Body",
						},
					},
				],
				"toolUse",
				{ input: 10, output: 20, cacheRead: 3, cacheWrite: 4, costTotal: 0.25 },
			),
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "todo-complete",
						name: "todo",
						arguments: {
							description: "Complete the required item",
							action: "update",
							id: 1,
							status: "done",
						},
					},
				],
				"toolUse",
				{ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
			),
			assistantMessage([{ type: "text", text: "complete" }], "stop", {
				input: 5,
				output: 6,
				cacheRead: 1,
				cacheWrite: 2,
				costTotal: 0.1,
			}),
		];
		let responseIndex = 0;
		const disposeComposition = vi.fn(async () => {});
		const factory = createKnowledgeProcessingSessionFactory({
			getModelRegistry: () => registry,
			knowledgeRoot: knowledgeDirectory,
			createSessionId: () => "knowledge-session",
			createComposition: createRecordedComposition({
				onFrame(model, context, streamOptions) {
					observedModels.push(model);
					observedFrames.push(JSON.stringify(context));
					observedReasoning.push(streamOptions?.reasoning);
				},
				readResponse() {
					const response = responses[responseIndex];
					responseIndex += 1;
					if (!response) throw new Error("Missing recorded response");
					return response;
				},
				onDispose: disposeComposition,
			}),
		});
		const writer = {
			write: vi.fn(async () => ({
				action: "create" as const,
				id: "page-id",
				path: "topic/page.md",
			})),
		};
		const session = await factory.create({
			cwd,
			sessionDir: conversationDir,
			modelKey: `${TARGET_MODEL.provider}/${TARGET_MODEL.id}`,
			reasoningLevel: "high",
			todoItems: ["first"],
			writer,
			appendSystemPrompt: "knowledge instructions",
			env: { TMPDIR: join(cwd, "tmp") },
		});
		const usages: unknown[] = [];
		const unsubscribeUsage = session.subscribeUsage((usage) => usages.push(usage));

		await session.run("process this batch");

		const firstFind = registryEvents.indexOf(`find:${TARGET_MODEL.provider}/${TARGET_MODEL.id}`);
		expect(registryEvents.indexOf("loadRemoteModels")).toBeGreaterThanOrEqual(0);
		expect(firstFind).toBeGreaterThan(registryEvents.indexOf("loadRemoteModels"));
		expect(observedModels).toEqual([TARGET_MODEL, TARGET_MODEL, TARGET_MODEL]);
		expect(observedReasoning).toEqual(["high", "high", "high"]);
		expect(observedFrames[0]).toContain("knowledge instructions");
		expect(observedFrames[0]).toContain('"name":"kb_write_page"');
		expect(observedFrames[1]).toContain("locked by scene");
		expect(observedFrames[1]).toContain(
			JSON.stringify(join(knowledgeDirectory, "wiki", "topic/page.md")).slice(1, -1),
		);
		expect(writer.write).toHaveBeenCalledOnce();
		expect(usages).toEqual([
			{
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 3,
				cacheWriteTokens: 4,
				costTotal: 0.25,
			},
			{
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costTotal: 0,
			},
			{
				inputTokens: 5,
				outputTokens: 6,
				cacheReadTokens: 1,
				cacheWriteTokens: 2,
				costTotal: 0.1,
			},
		]);

		unsubscribeUsage();
		await session.dispose();
		await session.dispose();
		expect(disposeComposition).toHaveBeenCalledOnce();
	});

	it("keeps the existing missing-model error and does not call the provider", async () => {
		const cwd = await createTemporaryDirectory("greenfield-kb-missing-cwd-");
		const conversationDir = await createTemporaryDirectory("greenfield-kb-missing-sessions-");
		const registry = modelRegistry([]);
		const stream = vi.fn();
		const factory = createKnowledgeProcessingSessionFactory({
			getModelRegistry: () => ({
				...registry,
				find: () => undefined,
			}),
			createComposition: (options) =>
				createCodingAgentRuntimeComposition({
					...options,
					resolveSystemPromptOptions: () => ({
						customPrompt: "Base prompt",
						scenario: "kb-processing",
					}),
					streamFn: stream,
				}),
		});
		const session = await factory.create({
			cwd,
			sessionDir: conversationDir,
			modelKey: "provider/missing",
			todoItems: [],
			writer: { write: vi.fn() },
			appendSystemPrompt: "knowledge instructions",
			env: {},
		});

		await expect(session.run("process")).rejects.toThrow(
			"知识库加工模型未找到：provider/missing（请在知识库设置里重新选择加工模型）",
		);
		expect(stream).not.toHaveBeenCalled();
		await session.dispose();
	});

	async function createTemporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function createRecordedComposition(options: {
	readonly onFrame: (
		model: Parameters<GreenfieldStreamFn>[0],
		context: Parameters<GreenfieldStreamFn>[1],
		options: Parameters<GreenfieldStreamFn>[2],
	) => void;
	readonly readResponse: () => AssistantMessage;
	readonly onDispose: () => Promise<void>;
}): NonNullable<KnowledgeProcessingSessionFactoryOptions["createComposition"]> {
	return async (compositionOptions) => {
		const composition = await createCodingAgentRuntimeComposition({
			...compositionOptions,
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "kb-processing",
			}),
			streamFn: (model, context, streamOptions) => {
				options.onFrame(model, context, streamOptions);
				return new RecordedAssistantStream(options.readResponse());
			},
		});
		return {
			...composition,
			async dispose() {
				try {
					await composition.dispose();
				} finally {
					await options.onDispose();
				}
			},
		};
	};
}

type GreenfieldStreamFn = NonNullable<CodingAgentRuntimeCompositionOptions["streamFn"]>;

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

function modelRegistry(events: string[]): CodingAgentRuntimeModelSource {
	return {
		refresh() {
			events.push("refresh");
		},
		getAvailable: () => [INITIAL_MODEL, TARGET_MODEL],
		find(provider, modelId) {
			events.push(`find:${provider}/${modelId}`);
			return provider === TARGET_MODEL.provider && modelId === TARGET_MODEL.id ? TARGET_MODEL : undefined;
		},
		getApiKey: async () => "test-key",
		setServerToken() {},
		async loadRemoteModels() {
			events.push("loadRemoteModels");
			return undefined;
		},
	};
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	usage: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly costTotal: number;
	},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: TARGET_MODEL.api,
		provider: TARGET_MODEL.provider,
		model: TARGET_MODEL.id,
		usage: {
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: usage.costTotal,
			},
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
}

const INITIAL_MODEL: Model<Api> = {
	id: "initial-model",
	name: "Initial Model",
	api: "openai-responses",
	provider: "initial",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

const TARGET_MODEL: Model<Api> = {
	...INITIAL_MODEL,
	id: "processing-model",
	name: "Processing Model",
	provider: "provider",
};
