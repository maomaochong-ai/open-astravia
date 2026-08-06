import type { Api, AssistantMessage, Message, Model, UserMessage } from "@vetta/ai";
import {
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	createEmptyConversationDocument,
	createSeededConversationDocument,
} from "@vetta/runtime-core/conversation";
import type {
	ContextCompactionRecord,
	ContextPreparationInput,
	ConversationContinuationResult,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	CodingAgentContextRuntime,
	type CodingAgentMemoryFlushInput,
	CodingAgentMemoryRolloverOrchestrator,
} from "../../src/adapters/runtime-core/index.js";
import type { CompactionSettings } from "../../src/compaction/index.js";

describe("Greenfield memory rollover context integration", () => {
	it("applies the legacy memory threshold, flushes the discarded prefix and requests generic continuation", async () => {
		const history = [
			userMessage("old request", 1),
			assistantMessage("old response", 30, 2),
			userMessage("recent request", 3),
			assistantMessage("recent response", 75, 4),
		] satisfies Message[];
		const document = documentFromMessages(history);
		const flushMemory = vi.fn(
			async (_input: CodingAgentMemoryFlushInput & { readonly memoryFile: string; readonly limit: number }) => [],
		);
		const trace: string[] = [];
		const memoryRollover = new CodingAgentMemoryRolloverOrchestrator({
			memoryFile: "C:\\memory\\MEMORY.md",
			cwd: "C:\\workspace",
			flushMemory,
			appendRolloverJournal: () => {
				trace.push("journal");
			},
		});
		const hooks = hookRuntime(trace);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: baseSettings,
			generateCompaction: async (preparation) => ({
				summary: "memory summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
			extensionRuntime: {
				beforeCompaction: async () => undefined,
				afterCompaction: async () => {
					trace.push("extension");
				},
			},
			memoryRollover,
			now: () => 3,
		});
		const input: ContextPreparationInput = {
			...preparationInput(document, history),
			reason: "model_call",
		};

		const prepared = await runtime.prepare(input, new AbortController().signal);
		const committed = await runtime.onCompactionCommitted(prepared.compaction!, input, new AbortController().signal);

		expect(prepared.compaction).toMatchObject({
			summary: "memory summary",
			reason: "threshold",
		});
		expect(flushMemory).toHaveBeenCalledOnce();
		expect(flushMemory.mock.calls[0]?.[0]?.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(committed).toEqual({
			continueExecution: true,
			continuation: { reason: "memory-rollover" },
		});
		expect(trace).toEqual(["journal"]);
		expect(hooks.runPostCompact).not.toHaveBeenCalled();

		trace.push("continuation");
		const committedDocument = continuationDocument(prepared.compaction!);
		const finalization = await runtime.onCompactionContinuationCommitted(
			prepared.compaction!,
			input,
			continuationResult(committedDocument),
			new AbortController().signal,
		);

		expect(finalization).toEqual({ continueExecution: true });
		expect(hooks.runPostCompact).toHaveBeenCalledOnce();
		expect(trace).toEqual(["journal", "continuation", "extension", "post-hook"]);
	});

	it("does not apply memory flush or continuation to manual compaction", async () => {
		const history = [userMessage("old request", 1), assistantMessage("old response", 75, 2)] satisfies Message[];
		const document = documentFromMessages(history);
		const flushMemory = vi.fn(
			async (_input: CodingAgentMemoryFlushInput & { readonly memoryFile: string; readonly limit: number }) => [],
		);
		const memoryRollover = new CodingAgentMemoryRolloverOrchestrator({
			memoryFile: "C:\\memory\\MEMORY.md",
			cwd: "C:\\workspace",
			flushMemory,
		});
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: () => ({ ...baseSettings(), reserveTokens: 90 }),
			generateCompaction: async (preparation) => ({
				summary: "manual summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
			memoryRollover,
		});

		const record = await runtime.compactManual(
			{
				sessionId: "session-1",
				document,
				modelBinding: { model: MODEL },
			},
			new AbortController().signal,
		);
		await runtime.onManualCompactionCommitted(
			record,
			{ sessionId: "session-1", document, modelBinding: { model: MODEL } },
			new AbortController().signal,
		);

		expect(record.reason).toBe("manual");
		expect(flushMemory).not.toHaveBeenCalled();
	});

	it("applies PostCompact stop only after the continuation has committed", async () => {
		const document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		const record: ContextCompactionRecord = {
			summary: "overflow summary",
			summaryMessage: userMessage("overflow summary", 2),
			firstKeptEntryId: "entry-1",
			tokensBefore: 100,
			reason: "overflow",
		};
		const hooks = hookRuntime(undefined, true);
		const memoryRollover = new CodingAgentMemoryRolloverOrchestrator({
			memoryFile: "C:\\memory\\MEMORY.md",
			cwd: "C:\\workspace",
			appendRolloverJournal: () => {},
		});
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			memoryRollover,
		});
		const input = preparationInput(document, []);

		const committed = await runtime.onCompactionCommitted(record, input, new AbortController().signal, document);
		expect(committed.continueExecution).toBe(true);
		expect(hooks.runPostCompact).not.toHaveBeenCalled();

		const finalized = await runtime.onCompactionContinuationCommitted(
			record,
			input,
			continuationResult(continuationDocument(record)),
			new AbortController().signal,
		);

		expect(finalized).toEqual({ continueExecution: false });
		expect(hooks.runPostCompact).toHaveBeenCalledOnce();
	});
});

function preparationInput(
	document: ConversationDocument,
	historyMessages: readonly Message[],
): ContextPreparationInput {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		historyMessages,
		messages: historyMessages,
		tokenBudget: MODEL.contextWindow,
		reservedOutputTokens: MODEL.maxTokens,
		modelBinding: { model: MODEL },
		document,
		reportObservation: async () => {},
	};
}

function documentFromMessages(messages: readonly Message[]): ConversationDocument {
	let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
	for (let index = 0; index < messages.length; index += 1) {
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "previous-turn",
				message: messages[index] as Message,
				timestamp: index + 1,
			},
			index + 1,
		);
	}
	return document;
}

function hookRuntime(trace?: string[], postShouldStop = false) {
	return {
		runPreCompact: vi.fn(async () => hookOutcome()),
		runPostCompact: vi.fn(async () => {
			trace?.push("post-hook");
			return hookOutcome(postShouldStop);
		}),
		markSessionStart: vi.fn(),
	};
}

function hookOutcome(shouldStop = false) {
	return {
		shouldStop,
		shouldBlock: false,
		additionalContexts: [],
		continuationFragments: [],
		runs: [],
	};
}

function continuationResult(seedDocument: ConversationDocument): ConversationContinuationResult {
	return {
		sourceSessionId: "session-1",
		sourceVersion: 5,
		sessionId: "session-2",
		version: 1,
		seedConversation: { sessionId: "session-2", createdAt: 2, version: 0, messages: [], events: [] },
		seedDocument,
		transferredEvent: {
			type: "turn.transferred",
			sessionId: "session-1",
			turnId: "turn-1",
			targetSessionId: "session-2",
			reason: "memory-rollover",
			timestamp: 2,
		},
		continuedEvent: {
			type: "turn.continued",
			sessionId: "session-2",
			turnId: "turn-1",
			sourceSessionId: "session-1",
			snapshotId: "snapshot-1",
			reason: "memory-rollover",
			timestamp: 2,
		},
	};
}

function continuationDocument(record: ContextCompactionRecord): ConversationDocument {
	return createSeededConversationDocument(
		{ sessionId: "session-2", createdAt: 2 },
		[
			{
				type: "compaction",
				id: "seed-1",
				parentId: null,
				timestamp: new Date(2).toISOString(),
				summary: record.summary,
				summaryMessage: record.summaryMessage,
				firstKeptEntryId: "seed-1",
				tokensBefore: record.tokensBefore,
				reason: record.reason,
			},
		],
		"seed-1",
	);
}

function baseSettings(): CompactionSettings {
	return {
		enabled: true,
		reserveTokens: 10,
		minFreePercent: 20,
		keepRecentTokens: 1,
	};
}

function userMessage(text: string, timestamp: number): UserMessage {
	return { role: "user", content: text, timestamp };
}

function assistantMessage(text: string, totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100,
	maxTokens: 20,
};
