import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import type { SessionEvent } from "@vetta/runtime-core";
import { wikiDir } from "@vetta/runtime-knowledge";
import type { KbWritePageOperations } from "@vetta/runtime-tools/coding";
import type { CodingAgentRuntimeModelSource } from "../runtime-contracts/index.js";
import { resolveCodingAgentKnowledgeRoot } from "./coding-agent-knowledge-runtime.js";
import type {
	KnowledgeProcessingPageWriter,
	KnowledgeProcessingSession,
	KnowledgeProcessingSessionFactory,
	KnowledgeProcessingSessionRequest,
	KnowledgeProcessingUsage,
} from "./knowledge-processing-contract.js";
import {
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition,
} from "./runtime-composition.js";

export interface KnowledgeProcessingSessionFactoryOptions {
	readonly getModelRegistry: () => CodingAgentRuntimeModelSource;
	readonly knowledgeRoot?: string;
	readonly createSessionId?: () => string;
	readonly createComposition?: (
		options: CodingAgentRuntimeCompositionOptions,
	) => Promise<CodingAgentRuntimeComposition>;
}

/**
 * 在 Knowledge Processing Port 后组合独占的 Coding Agent Runtime。
 *
 * Writer 与 Todo 锁都停留在 Coding Agent 产品层；通用 RuntimeHost 无需认识
 * Knowledge、KbWriteSession 或可写 TodoStore。
 */
export function createKnowledgeProcessingSessionFactory(
	options: KnowledgeProcessingSessionFactoryOptions,
): KnowledgeProcessingSessionFactory {
	const createSessionId = options.createSessionId ?? randomUUID;
	const createComposition = options.createComposition ?? createCodingAgentRuntimeComposition;
	const resolvedKnowledgeRoot = resolveCodingAgentKnowledgeRoot(options.knowledgeRoot);

	return {
		async create(request) {
			const modelRuntime = options.getModelRegistry();
			modelRuntime.refresh();
			const initialModel = readInitialModel(modelRuntime);
			const composition = await createComposition({
				conversationDir: request.sessionDir,
				modelRegistry: modelRuntime,
				initialModel,
				initialThinkingLevel: "off",
				cwd: request.cwd,
				scenario: "kb-processing",
				knowledgeEnabled: true,
				knowledgeRoot: resolvedKnowledgeRoot,
				enableSubagents: false,
			});
			let runtimeSession: Awaited<ReturnType<CodingAgentRuntimeComposition["backend"]["create"]>>;
			try {
				runtimeSession = await composition.backend.create({
					sessionId: createSessionId(),
					cwd: request.cwd,
					model: initialModel,
					env: request.env,
					enableBackgroundTasks: false,
					systemPromptAddon: request.appendSystemPrompt,
					initialTodos: request.todoItems,
					initialTodoLockSource: request.todoItems.length > 0 ? "scene" : undefined,
					knowledgePageWriter: adaptKnowledgePageWriter(request.writer, resolvedKnowledgeRoot),
				});
			} catch (error) {
				await composition.dispose();
				throw error;
			}

			return createKnowledgeProcessingSession(runtimeSession, composition, request, modelRuntime);
		},
	};
}

function createKnowledgeProcessingSession(
	runtimeSession: Awaited<ReturnType<CodingAgentRuntimeComposition["backend"]["create"]>>,
	composition: CodingAgentRuntimeComposition,
	request: KnowledgeProcessingSessionRequest,
	modelRuntime: CodingAgentRuntimeModelSource,
): KnowledgeProcessingSession {
	let disposePromise: Promise<void> | undefined;
	return {
		async run(prompt) {
			const modelKey = parseModelKey(request.modelKey);
			if (modelKey) {
				await modelRuntime.loadRemoteModels();
				const model = modelRuntime.find(modelKey.provider, modelKey.modelId);
				if (!model) {
					throw new Error(`知识库加工模型未找到：${request.modelKey}（请在知识库设置里重新选择加工模型）`);
				}
			}
			const result = await runtimeSession.prompt({
				text: prompt,
				modelKey: modelKey ? request.modelKey : undefined,
				reasoning: modelKey ? request.reasoningLevel : undefined,
			});
			if (result.status === "failed") {
				throw new Error(result.error.message);
			}
		},
		abort: () => runtimeSession.abort(),
		subscribeUsage: (listener) =>
			runtimeSession.subscribe((event) => {
				const usage = projectUsage(event);
				if (usage) listener(usage);
			}),
		dispose() {
			disposePromise ??= disposeRuntimeSession(runtimeSession, composition);
			return disposePromise;
		},
	};
}

async function disposeRuntimeSession(
	runtimeSession: Awaited<ReturnType<CodingAgentRuntimeComposition["backend"]["create"]>>,
	composition: CodingAgentRuntimeComposition,
): Promise<void> {
	try {
		await runtimeSession.dispose();
	} finally {
		await composition.dispose();
	}
}

function readInitialModel(modelRuntime: CodingAgentRuntimeModelSource): Model<Api> {
	const model = modelRuntime.getAvailable()[0];
	if (!model) {
		throw new Error("Greenfield Knowledge Processing requires at least one available model");
	}
	return model;
}

function parseModelKey(modelKey: string): { readonly provider: string; readonly modelId: string } | undefined {
	const slash = modelKey.indexOf("/");
	if (slash <= 0) return undefined;
	return {
		provider: modelKey.slice(0, slash),
		modelId: modelKey.slice(slash + 1),
	};
}

function adaptKnowledgePageWriter(
	writer: KnowledgeProcessingPageWriter,
	resolvedKnowledgeRoot: string,
): KbWritePageOperations {
	return {
		write: (request, now) => writer.write(request, now),
		resolveAbsolutePath: (relativeWikiPath) => join(wikiDir(resolvedKnowledgeRoot), relativeWikiPath),
	};
}

function projectUsage(event: SessionEvent): KnowledgeProcessingUsage | undefined {
	if (event.type !== "usage.update") return undefined;
	return {
		inputTokens: event.input,
		outputTokens: event.output,
		cacheReadTokens: event.cacheRead,
		cacheWriteTokens: event.cacheWrite,
		costTotal: event.costTotal,
	};
}
