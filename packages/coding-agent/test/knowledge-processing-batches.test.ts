import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import {
	createKnowledgePageWriter,
	readManifest,
	readTagsIndex,
	rebuildAllCaches,
	scanWikiPages,
	type WritePageRequest,
} from "@vetta/runtime-knowledge";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../src/adapters/runtime-core/model-runtime-adapter.js";
import {
	createKnowledgeProcessingSessionFactory,
	type KnowledgeProcessingSessionFactoryOptions,
} from "../src/composition/knowledge-processing-session.js";
import { createCodingAgentRuntimeComposition } from "../src/composition/runtime-composition.js";

describe("Knowledge processing batches", () => {
	const directories: string[] = [];

	afterEach(async () => {
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("matches the existing writer baseline while concurrent sessions share one write session", async () => {
		const root = await temporaryDirectory("greenfield-kb-batches-");
		const baselineRoot = await temporaryDirectory("greenfield-kb-baseline-");
		const cwd = await temporaryDirectory("greenfield-kb-batch-cwd-");
		const sessionDir = await temporaryDirectory("greenfield-kb-batch-sessions-");
		const requests = [PAGE_A, PAGE_B] as const;

		const baselineWriter = await createKnowledgePageWriter(baselineRoot);
		for (const request of requests) {
			await baselineWriter.write(request, "2026-07-31T00:00:00.000Z");
		}

		const writer = await createKnowledgePageWriter(root);
		const sharedWrite = vi.fn(writer.write.bind(writer));
		const disposeComposition = vi.fn(async () => {});
		let nextSessionId = 1;
		const factory = createKnowledgeProcessingSessionFactory({
			getModelRegistry: () => modelRegistry(),
			knowledgeRoot: root,
			createSessionId: () => `knowledge-batch-${nextSessionId++}`,
			createComposition: createBatchComposition(requests, disposeComposition),
		});
		const sessions = await Promise.all(
			requests.map((_, index) =>
				factory
					.create({
						cwd,
						sessionDir,
						modelKey: `${MODEL.provider}/${MODEL.id}`,
						reasoningLevel: "medium",
						todoItems: [],
						writer: { write: sharedWrite },
						appendSystemPrompt: "knowledge instructions",
						env: {},
					})
					.then((session) => ({ index, session })),
			),
		);
		const usages: unknown[] = [];
		const unsubscribes = sessions.map(({ session }) => session.subscribeUsage((usage) => usages.push(usage)));

		try {
			await Promise.all(sessions.map(({ index, session }) => session.run(`process knowledge-batch-${index + 1}`)));
		} finally {
			for (const unsubscribe of unsubscribes) unsubscribe();
			await Promise.all(sessions.map(({ session }) => session.dispose()));
		}

		expect(sharedWrite).toHaveBeenCalledTimes(2);
		expect(disposeComposition).toHaveBeenCalledTimes(2);
		expect(usages).toHaveLength(4);
		expect(await readNormalizedKnowledgeSnapshot(root)).toEqual(await readNormalizedKnowledgeSnapshot(baselineRoot));
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function createBatchComposition(
	requests: readonly [WritePageRequest, WritePageRequest],
	onDispose: () => Promise<void>,
): NonNullable<KnowledgeProcessingSessionFactoryOptions["createComposition"]> {
	return async (options) => {
		let request: WritePageRequest | undefined;
		let streamIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			...options,
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				scenario: "kb-processing",
			}),
			streamFn: (_model, context) => {
				request ??= JSON.stringify(context).includes("knowledge-batch-1") ? requests[0] : requests[1];
				const message =
					streamIndex++ === 0
						? assistantMessage([
								{
									type: "toolCall",
									id: `write-${request.source_hash}`,
									name: "kb_write_page",
									arguments: {
										description: `Write ${request.source_path}`,
										...request,
									},
								},
							])
						: assistantMessage([{ type: "text", text: "complete" }]);
				return new RecordedAssistantStream(message);
			},
		});
		return {
			...composition,
			async dispose() {
				try {
					await composition.dispose();
				} finally {
					await onDispose();
				}
			},
		};
	};
}

async function readNormalizedKnowledgeSnapshot(root: string): Promise<unknown> {
	await rebuildAllCaches(root);
	const [{ pages, errors }, manifest, tags] = await Promise.all([
		scanWikiPages(root),
		readManifest(root),
		readTagsIndex(root),
	]);
	const sortedPages = [...pages].sort((left, right) =>
		left.frontmatter.source_path.localeCompare(right.frontmatter.source_path),
	);
	const sourcePathById = new Map(sortedPages.map((page) => [page.frontmatter.id, page.frontmatter.source_path]));
	return {
		errors,
		physicalPaths: sortedPages.map(({ frontmatter, path }) => normalizeGeneratedPath(path, frontmatter.id)).sort(),
		pages: sortedPages.map(({ body, frontmatter }) => ({
			source: frontmatter.source,
			sourcePath: frontmatter.source_path,
			sourceHash: frontmatter.source_hash,
			tags: frontmatter.tags,
			title: frontmatter.title,
			summary: frontmatter.summary,
			orphanedAt: frontmatter.orphaned_at,
			body,
		})),
		manifest: manifest.pages
			.map((entry) => ({
				source_path: entry.source_path,
				source_hash: entry.source_hash,
				orphaned_at: entry.orphaned_at,
			}))
			.sort((left, right) => left.source_path.localeCompare(right.source_path)),
		tags: Object.fromEntries(
			Object.entries(tags.tags)
				.map(([tag, ids]) => [tag, ids.map((id) => sourcePathById.get(id) ?? `missing:${id}`).sort()] as const)
				.sort(([left], [right]) => left.localeCompare(right)),
		),
	};
}

function normalizeGeneratedPath(path: string, id: string): string {
	const generatedSuffix = `-${id.slice(0, 8)}.md`;
	return path.endsWith(generatedSuffix) ? `${path.slice(0, -generatedSuffix.length)}-<generated>.md` : path;
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
			this.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
		});
	}
}

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	const toolUse = content.some((part) => part.type === "toolCall");
	return {
		role: "assistant",
		content,
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 2,
			output: 3,
			cacheRead: 1,
			cacheWrite: 0,
			totalTokens: 6,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0.01,
			},
		},
		stopReason: toolUse ? "toolUse" : "stop",
		timestamp: Date.now(),
	};
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

const MODEL: Model<Api> = {
	id: "processing-model",
	name: "Processing Model",
	api: "openai-responses",
	provider: "provider",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

const PAGE_A: WritePageRequest = {
	path: "产品/api.md",
	source: "手册",
	source_path: "手册/api.md",
	source_hash: "hash-a",
	tags: ["api", "manual"],
	title: "API",
	summary: "API 文档",
	body: "# API\n\n内容 A",
};

const PAGE_B: WritePageRequest = {
	path: "产品/api.md",
	source: "手册",
	source_path: "手册/billing.md",
	source_hash: "hash-b",
	tags: ["billing", "manual"],
	title: "Billing",
	summary: "计费文档",
	body: "# Billing\n\n内容 B",
};
