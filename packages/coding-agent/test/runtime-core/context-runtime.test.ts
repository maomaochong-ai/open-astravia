import type { Api, AssistantMessage, Message, Model, UserMessage } from "@vetta/ai";
import type { HookDispatchOutcome } from "@vetta/ecosystem-adapter/hooks";
import {
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core/conversation";
import type {
	ContextPreparationInput,
	RuntimeSessionObservationEvent,
	StoredSessionEvent,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	CodingAgentContextRuntime,
	type CodingAgentContextRuntimeOptions,
} from "../../src/adapters/runtime-core/context-runtime/index.js";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "../../src/compaction/index.js";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../../src/model-context/index.js";
import type { CodingAgentCompactionExtensionRuntime } from "../../src/runtime-contracts/index.js";

describe("CodingAgentContextRuntime", () => {
	it("persists a threshold compaction while keeping transient turn input outside the summary", async () => {
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const currentInput = userMessage("current input", 4);
		const observations: RuntimeSessionObservationEvent[] = [];
		const hooks = createHookRuntime();
		const generateCompaction = vi.fn(
			async (preparation: CompactionPreparation): Promise<CompactionResult> => ({
				summary: "summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: { source: "test" },
			}),
		);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
			now: () => 42,
		});
		const input: ContextPreparationInput = {
			...preparationInput(
				documentFromMessages([...history, currentInput]),
				[...history, currentInput],
				[...history, currentInput],
				observations,
			),
			reason: "model_call",
		};

		const prepared = await runtime.prepare(input, new AbortController().signal);

		expect(generateCompaction).toHaveBeenCalledOnce();
		expect(prepared.compaction).toEqual({
			summary: "summary",
			summaryMessage: {
				role: "user",
				content: [
					{
						type: "text",
						text: `${COMPACTION_SUMMARY_PREFIX}summary${COMPACTION_SUMMARY_SUFFIX}`,
					},
				],
				timestamp: 42,
			},
			firstKeptEntryId: "event-4",
			tokensBefore: 97,
			details: { source: "test" },
			reason: "threshold",
		});
		expect(prepared.messages.map(messageText)).toEqual([
			`${COMPACTION_SUMMARY_PREFIX}summary${COMPACTION_SUMMARY_SUFFIX}`,
			"current input",
		]);
		expect(hooks.runPreCompact).toHaveBeenCalledWith("auto", expect.any(AbortSignal));
		expect(hooks.runPostCompact).not.toHaveBeenCalled();
		expect(observations).toEqual([{ type: "compaction.start", reason: "threshold", source: "agent" }]);

		const commitResult = await runtime.onCompactionCommitted(
			prepared.compaction!,
			input,
			new AbortController().signal,
		);

		expect(commitResult).toEqual({ continueExecution: true });
		expect(hooks.runPostCompact).toHaveBeenCalledWith("auto", expect.any(AbortSignal));
		expect(hooks.markSessionStart).toHaveBeenCalledWith("compact");
		expect(observations).toEqual([{ type: "compaction.start", reason: "threshold", source: "agent" }]);
	});

	it("persists recoverable work state in both the compaction record and model-visible summary", async () => {
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction: async (preparation) => ({
				summary: "summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
			readCompactionWorkState: () => ({
				todos: [{ id: 1, content: "run checks", status: "in_progress" }],
				backgroundTasks: [
					{
						id: "task-1",
						command: "bunx vitest --run",
						status: "running",
						outputFile: "C:/tmp/task-1.log",
					},
				],
			}),
			now: () => 42,
		});

		const record = await runtime.compactManual(
			{
				sessionId: "session-1",
				document: documentFromMessages(history),
				modelBinding: { model: MODEL },
			},
			new AbortController().signal,
		);

		expect(record.summary).toContain("<runtime-work-state>");
		expect(record.summary).toContain('"nextTodoId":1');
		expect(record.summary).toContain('"id":"task-1"');
		expect(messageText(record.summaryMessage)).toBe(
			`${COMPACTION_SUMMARY_PREFIX}${record.summary}${COMPACTION_SUMMARY_SUFFIX}`,
		);
	});

	it("does not generate or persist a compaction when the pre-compact hook blocks", async () => {
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const observations: RuntimeSessionObservationEvent[] = [];
		const generateCompaction = vi.fn(async (_preparation: CompactionPreparation): Promise<CompactionResult> => {
			throw new Error("must not run");
		});
		const hooks = createHookRuntime({
			...emptyHookOutcome(),
			shouldBlock: true,
			blockReason: "blocked by test",
		});
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
		});
		const input: ContextPreparationInput = {
			...preparationInput(documentFromMessages(history), history, history, observations),
			reason: "model_call",
		};

		const prepared = await runtime.prepare(input, new AbortController().signal);

		expect(prepared.messages).toEqual(history);
		expect(prepared.compaction).toBeUndefined();
		expect(generateCompaction).not.toHaveBeenCalled();
		expect(observations).toEqual([
			{ type: "compaction.start", reason: "threshold", source: "agent" },
			{
				type: "compaction.end",
				success: false,
				errorMessage: "blocked by test",
				source: "agent",
			},
		]);
	});

	it("compacts at a same-turn model-call checkpoint and preserves transient provider context", async () => {
		const persistentMessages = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
			toolResultMessage(1),
		] satisfies Message[];
		const providerMessage = userMessage("provider context", 10);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: () => ({ ...compactingSettings(), keepRecentTokens: 5 }),
			generateCompaction: async (preparation) => ({
				summary: "summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
			now: () => 42,
		});
		const observations: RuntimeSessionObservationEvent[] = [];
		const input: ContextPreparationInput = {
			...preparationInput(
				documentFromMessages(persistentMessages),
				persistentMessages,
				[persistentMessages[0], persistentMessages[1], providerMessage, ...persistentMessages.slice(2)],
				observations,
			),
			reason: "model_call",
			transientMessages: [providerMessage],
		};

		const prepared = await runtime.prepare(input, new AbortController().signal);

		expect(prepared.compaction?.reason).toBe("threshold");
		expect(prepared.messages.map(messageText)).toEqual([
			`${COMPACTION_SUMMARY_PREFIX}summary${COMPACTION_SUMMARY_SUFFIX}`,
			"provider context",
			"kept request",
			"result-1",
		]);
		expect(observations).toEqual([{ type: "compaction.start", reason: "threshold", source: "agent" }]);
	});

	it("compacts and retries only the first matching-model overflow without retaining the error message", async () => {
		const overflow = overflowAssistantMessage(4);
		const messages = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
			overflow,
		] satisfies Message[];
		const generateCompaction = vi.fn(
			async (preparation: CompactionPreparation): Promise<CompactionResult> => ({
				summary: "overflow summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
		);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
			now: () => 42,
		});
		const observations: RuntimeSessionObservationEvent[] = [];
		const baseInput = preparationInput(documentFromMessages(messages), messages, messages, observations);

		const prepared = await runtime.prepare(
			{
				...baseInput,
				reason: "assistant_error",
				triggeringAssistantMessage: overflow,
				recoveryAttempt: 0,
			},
			new AbortController().signal,
		);
		const repeated = await runtime.prepare(
			{
				...baseInput,
				reason: "assistant_error",
				triggeringAssistantMessage: overflow,
				recoveryAttempt: 1,
			},
			new AbortController().signal,
		);

		expect(generateCompaction).toHaveBeenCalledOnce();
		expect(prepared.compaction?.reason).toBe("overflow");
		expect(prepared.messages.map(messageText)).not.toContain("prompt is too long");
		expect(repeated.compaction).toBeUndefined();
		expect(observations).toEqual([{ type: "compaction.start", reason: "overflow", source: "agent" }]);
	});

	it("retries an image-rejected request once without images before falling back to overflow compaction", async () => {
		const rejected = {
			...assistantMessage("rejected", 0, 4),
			stopReason: "error" as const,
			errorMessage: "413 status code (no body)",
		};
		const messages = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userImageMessage("image-data", 3),
			rejected,
		] satisfies Message[];
		const generateCompaction = vi.fn(
			async (preparation: CompactionPreparation): Promise<CompactionResult> => ({
				summary: "image overflow summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
		);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
		});
		const observations: RuntimeSessionObservationEvent[] = [];

		const imageRetry = await runtime.prepare(
			{
				...preparationInput(documentFromMessages(messages), messages, messages, observations),
				reason: "assistant_error",
				triggeringAssistantMessage: rejected,
				recoveryAttempt: 0,
			},
			new AbortController().signal,
		);
		const repeated = { ...rejected, timestamp: 5 };
		const repeatedMessages = [...imageRetry.messages, repeated];
		const compacted = await runtime.prepare(
			{
				...preparationInput(
					documentFromMessages(repeatedMessages),
					repeatedMessages,
					repeatedMessages,
					observations,
				),
				reason: "assistant_error",
				triggeringAssistantMessage: repeated,
				recoveryAttempt: 1,
			},
			new AbortController().signal,
		);

		expect(imageRetry.retry).toBe(true);
		expect(imageRetry.compaction).toBeUndefined();
		expect(imageRetry.messages).not.toContain(rejected);
		expect(messageText(imageRetry.messages.at(-1))).toContain("image omitted after the model rejected");
		expect(messageText(messages[2])).toBe("");
		expect(compacted.compaction?.reason).toBe("overflow");
		expect(generateCompaction).toHaveBeenCalledOnce();
	});

	it("treats a successful response whose input usage exceeds the context window as overflow", async () => {
		const silentOverflow = assistantMessage("truncated response", 101, 4);
		const messages = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
			silentOverflow,
		] satisfies Message[];
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction: async (preparation) => ({
				summary: "overflow summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}),
		});
		const observations: RuntimeSessionObservationEvent[] = [];

		const prepared = await runtime.prepare(
			{
				...preparationInput(documentFromMessages(messages), messages, messages, observations),
				reason: "assistant_result",
				triggeringAssistantMessage: silentOverflow,
				recoveryAttempt: 0,
			},
			new AbortController().signal,
		);

		expect(prepared.compaction?.reason).toBe("overflow");
		expect(prepared.messages.map(messageText)).not.toContain("truncated response");
		expect(observations).toEqual([{ type: "compaction.start", reason: "overflow", source: "agent" }]);
	});

	it("runs manual compaction through extension override and committed callback without invoking the summarizer", async () => {
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const document = documentFromMessages(history);
		const hooks = createHookRuntime();
		const extensionRuntime: CodingAgentCompactionExtensionRuntime = {
			beforeCompaction: vi.fn(async (input) => {
				expect(input.customInstructions).toBe("preserve decisions");
				return {
					compaction: {
						summary: "extension summary",
						firstKeptEntryId: input.preparation.firstKeptEntryId,
						tokensBefore: input.preparation.tokensBefore,
						details: { source: "extension" },
					},
				};
			}),
			afterCompaction: vi.fn(async () => {}),
		};
		const generateCompaction = vi.fn(async (): Promise<CompactionResult> => {
			throw new Error("summarizer must not run");
		});
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
			extensionRuntime,
			now: () => 42,
		});

		const record = await runtime.compactManual(
			{
				sessionId: "session-1",
				document,
				modelBinding: { model: MODEL },
				customInstructions: "preserve decisions",
			},
			new AbortController().signal,
		);
		const committedDocument = applyStoredEventToConversationDocument(
			document,
			{
				type: "context.compacted",
				sessionId: "session-1",
				record,
				timestamp: 42,
			},
			document.journalVersion + 1,
		);
		await runtime.onManualCompactionCommitted(
			record,
			{ sessionId: "session-1", document, modelBinding: { model: MODEL } },
			new AbortController().signal,
			committedDocument,
		);

		expect(record).toMatchObject({
			summary: "extension summary",
			firstKeptEntryId: "event-3",
			tokensBefore: 93,
			details: { source: "extension" },
			fromHook: true,
			reason: "manual",
		});
		expect(generateCompaction).not.toHaveBeenCalled();
		expect(hooks.runPreCompact).toHaveBeenCalledWith("manual", expect.any(AbortSignal));
		expect(extensionRuntime.afterCompaction).toHaveBeenCalledWith({
			compactionEntry: expect.objectContaining({
				type: "compaction",
				summary: "extension summary",
				firstKeptEntryId: "event-3",
			}),
			fromExtension: true,
		});
		expect(hooks.runPostCompact).toHaveBeenCalledWith("manual", expect.any(AbortSignal));
		expect(hooks.markSessionStart).toHaveBeenCalledWith("compact");
		expect(runtime.readAutoCompactionEnabled()).toBe(true);
		runtime.setAutoCompactionEnabled(false);
		expect(runtime.readAutoCompactionEnabled()).toBe(false);
	});

	it("preserves extension cancellation semantics for manual compaction", async () => {
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const extensionRuntime: CodingAgentCompactionExtensionRuntime = {
			beforeCompaction: vi.fn(async () => ({ cancel: true })),
			afterCompaction: vi.fn(async () => {}),
		};
		const generateCompaction = vi.fn(async (): Promise<CompactionResult> => {
			throw new Error("summarizer must not run");
		});
		const hooks = createHookRuntime();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
			extensionRuntime,
		});

		await expect(
			runtime.compactManual(
				{
					sessionId: "session-1",
					document: documentFromMessages(history),
					modelBinding: { model: MODEL },
				},
				new AbortController().signal,
			),
		).rejects.toThrow("Compaction cancelled");

		expect(extensionRuntime.beforeCompaction).toHaveBeenCalledOnce();
		expect(extensionRuntime.afterCompaction).not.toHaveBeenCalled();
		expect(generateCompaction).not.toHaveBeenCalled();
		expect(hooks.runPostCompact).not.toHaveBeenCalled();
		expect(hooks.markSessionStart).not.toHaveBeenCalled();
	});

	it("keeps low-pressure ToolResults on every model call without mutating persisted messages", async () => {
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
		});
		const messages = Array.from({ length: 9 }, (_, index) => toolResultMessage(index));
		const input = {
			sessionId: "session-1",
			turnId: "turn-1",
			messages,
			modelBinding: { model: MODEL },
		};

		const first = await runtime.transform(input, new AbortController().signal);
		const second = await runtime.transform(input, new AbortController().signal);

		expect(messageText(first[0])).toBe("result-0");
		expect(messageText(second[0])).toBe("result-0");
		expect(messageText(messages[0])).toBe("result-0");
		expect(first).not.toBe(second);
	});

	it("runs Extension context once with opaque identities and keeps model-invisible messages out of the call", async () => {
		const customMessage = {
			role: "custom" as const,
			customType: "visible-context",
			content: "visible",
			display: true,
			timestamp: 10,
		};
		const transformAgentContext = vi.fn(async (messages) => structuredClone(messages));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			transformAgentContext,
		});
		const input = {
			sessionId: "session-1",
			turnId: "turn-1",
			messages: [userMessage("visible", 10)],
			messageEnvelopes: [
				{
					kind: "opaque" as const,
					identity: customMessage,
					modelMessage: userMessage("visible", 10),
					timestamp: 10,
				},
				{
					kind: "context" as const,
					record: { type: "hidden-context", content: "hidden", modelVisible: false },
					timestamp: 11,
				},
			],
			modelBinding: { model: MODEL },
		};

		const transformed = await runtime.transform(input, new AbortController().signal);

		expect(transformAgentContext).toHaveBeenCalledOnce();
		expect(transformAgentContext.mock.calls[0][0]).toMatchObject([
			{ role: "custom", customType: "visible-context", content: "visible" },
			{ role: "custom", customType: "hidden-context", content: "hidden" },
		]);
		expect(transformed.map(messageText)).toEqual(["visible"]);
	});

	it("restores context usage from the document and then reports exact assistant usage", async () => {
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
		});
		runtime.initialize(documentFromMessages([userMessage("request", 1), assistantMessage("old", 125, 2)]));
		expect(runtime.readUsage(1_000)).toEqual({ tokens: 125, contextWindow: 1_000, percent: 12.5 });

		const message = assistantMessage("response", 250, 1);
		const event: StoredSessionEvent = {
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message,
			timestamp: 1,
		};

		await runtime.observe(event);

		expect(runtime.readUsage(1_000)).toEqual({ tokens: 250, contextWindow: 1_000, percent: 25 });
	});
});

function preparationInput(
	document: ConversationDocument,
	historyMessages: readonly Message[],
	messages: readonly Message[],
	observations: RuntimeSessionObservationEvent[],
): ContextPreparationInput {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		historyMessages,
		messages,
		tokenBudget: MODEL.contextWindow,
		reservedOutputTokens: MODEL.maxTokens,
		modelBinding: { model: MODEL },
		document,
		reportObservation: async (observation) => {
			observations.push(observation);
		},
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

function createHookRuntime(preCompactOutcome: HookDispatchOutcome = emptyHookOutcome()) {
	return {
		runPreCompact: vi.fn(async () => preCompactOutcome),
		runPostCompact: vi.fn(async () => emptyHookOutcome()),
		markSessionStart: vi.fn(),
	} satisfies CodingAgentContextRuntimeOptions["hookRuntime"];
}

function emptyHookOutcome(): HookDispatchOutcome {
	return {
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		continuationFragments: [],
		runs: [],
	};
}

function compactingSettings(): CompactionSettings {
	return {
		enabled: true,
		reserveTokens: 20,
		minFreePercent: 20,
		keepRecentTokens: 1,
	};
}

function userMessage(text: string, timestamp: number): UserMessage {
	return { role: "user", content: text, timestamp };
}

function userImageMessage(data: string, timestamp: number): UserMessage {
	return { role: "user", content: [{ type: "image", data, mimeType: "image/png" }], timestamp };
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

function overflowAssistantMessage(timestamp: number): AssistantMessage {
	return {
		...assistantMessage("prompt is too long", 0, timestamp),
		stopReason: "error",
		errorMessage: "prompt is too long: 101 tokens > 100 maximum",
	};
}

function toolResultMessage(index: number): Extract<Message, { role: "toolResult" }> {
	return {
		role: "toolResult",
		toolCallId: `call-${index}`,
		toolName: "read",
		content: [{ type: "text", text: `result-${index}` }],
		isError: false,
		timestamp: 1,
	};
}

function messageText(message: Message | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
		.map(({ text }) => text)
		.join("");
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
