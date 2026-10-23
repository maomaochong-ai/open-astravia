import {
	AI_ERROR_CODES,
	type Api,
	type AssistantMessage,
	isAIError,
	type Message,
	type Model,
	type UserMessage,
} from "@astravia/ai";
import type { HookDispatchOutcome } from "@astravia/ecosystem-adapter/hooks";
import {
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	createEmptyConversationDocument,
} from "@astravia/runtime-core/conversation";
import type {
	ContextPreparationInput,
	RuntimeSessionObservationEvent,
	StoredSessionEvent,
} from "@astravia/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	type CompactionPreparation,
	type CompactionResult,
	type CompactionSettings,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	shouldCompact,
} from "../../src/compaction/index.js";
import { toActiveCompactionSessionEntries } from "../../src/compaction/runtime/conversation-compaction-projection.js";
import {
	DefaultCodingAgentContextRuntime as CodingAgentContextRuntime,
	type CodingAgentContextRuntimeOptions,
} from "../../src/compaction/runtime/index.js";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../../src/model-context/index.js";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentPinnedModelContext,
} from "../../src/runtime-contracts/index.js";

describe("DefaultCodingAgentContextRuntime", () => {
	it("rebuilds the active compaction source from the latest summary, its kept tail, and later growth", () => {
		let document = documentFromMessages([
			userMessage("discarded", 1),
			userMessage("kept", 2),
			assistantMessage("kept response", 20, 3),
		]);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "context.compacted",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					summary: "previous summary",
					summaryMessage: userMessage("previous summary", 4),
					firstKeptEntryId: "event-2",
					tokensBefore: 20,
					reason: "threshold",
				},
				timestamp: 4,
			},
			4,
		);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: userMessage("new growth", 5),
				timestamp: 5,
			},
			5,
		);

		const entries = toActiveCompactionSessionEntries(document);

		expect(entries.map(({ id }) => id)).toEqual(["event-4", "event-2", "event-3", "event-5"]);
		expect(entries.map(({ type }) => type)).toEqual(["compaction", "message", "message", "message"]);
	});

	it("summarizes only supplied records with the admitted model settings and no compaction hooks", async () => {
		let settings = compactingSettings();
		const hooks = createHookRuntime();
		const generateCompaction = vi.fn(
			async (
				preparation: CompactionPreparation,
				_model: Model<Api>,
				_apiKey: string,
				customInstructions: string | undefined,
			) => ({
				summary: "shared public summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: { instructions: customInstructions },
			}),
		);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: () => settings,
			generateCompaction,
		});
		const signal = new AbortController().signal;
		const bound = await runtime.bindForTurn({
			sessionId: "leader-session",
			operationId: "shared-summary",
			reason: "context_summary",
			signal,
		});
		settings = { ...settings, keepRecentTokens: settings.keepRecentTokens + 1 };

		await expect(
			bound.summarizeContext(
				{
					sessionId: "leader-session",
					records: [
						{
							type: "team.public",
							content: "member-visible decision",
							modelVisible: true,
							metadata: { authorAgentId: "leader" },
							timestamp: 5,
						},
					],
					modelBinding: { model: MODEL },
					previousSummary: "older public summary",
					customInstructions: "preserve author attribution",
				},
				signal,
			),
		).resolves.toMatchObject({
			summary: "shared public summary",
			details: { instructions: "preserve author attribution" },
		});

		const preparation = generateCompaction.mock.calls[0]?.[0];
		expect(preparation).toMatchObject({
			firstKeptEntryId: "transient-context-summary-boundary",
			previousSummary: "older public summary",
			isSplitTurn: false,
			settings: compactingSettings(),
		});
		expect(preparation?.messagesToSummarize).toEqual([
			expect.objectContaining({
				role: "custom",
				customType: "team.public",
				content: "member-visible decision",
				details: { authorAgentId: "leader" },
			}),
		]);
		expect(hooks.runPreCompact).not.toHaveBeenCalled();
		expect(hooks.runPostCompact).not.toHaveBeenCalled();
		await bound.releaseTurnBinding?.();
	});

	it("rejects non-model-visible records before resolving summary credentials", async () => {
		const resolveApiKey = vi.fn(() => "key");
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey,
		});
		await expect(
			runtime.summarizeContext(
				{
					sessionId: "session-1",
					records: [{ type: "private", content: "secret", modelVisible: false }],
					modelBinding: { model: MODEL },
				},
				new AbortController().signal,
			),
		).rejects.toThrow("non-model-visible");
		expect(resolveApiKey).not.toHaveBeenCalled();
	});

	it("captures all context contributors synchronously before awaiting pinned materialization", async () => {
		let resolvePinned!: (value: CodingAgentPinnedModelContext) => void;
		const pending = new Promise<CodingAgentPinnedModelContext>((resolve) => {
			resolvePinned = resolve;
		});
		let version = 1;
		const captures: number[] = [];
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			bindPinnedModelContext: () => pending,
			extensionRuntime: createExtensionRuntime({
				bindForTurn: () => {
					captures.push(version);
					return createExtensionRuntime({});
				},
			}),
			bindTransformAgentContext: () => {
				const capturedVersion = version;
				captures.push(version);
				return {
					transform: async (messages) => [...messages, userMessage(`transform-${capturedVersion}`, 2)],
					release() {},
				};
			},
		});
		const signal = new AbortController().signal;
		const binding = runtime.bindForTurn({ sessionId: "session-1", operationId: "turn", reason: "turn", signal });
		version = 2;
		resolvePinned({
			id: "shared",
			records: [{ type: "public", content: "shared", timestamp: 1, modelVisible: true }],
		});
		const bound = await binding;
		try {
			expect(captures).toEqual([1, 1]);
			expect(
				(
					await bound.transform(
						{ sessionId: "session-1", turnId: "turn", messages: [], modelBinding: { model: MODEL } },
						signal,
					)
				).map(messageText),
			).toEqual(["shared", "transform-1"]);
		} finally {
			await bound.releaseTurnBinding?.();
		}
	});

	it.each(["invalid", "cancelled"] as const)(
		"releases captures when asynchronous pinned materialization is %s",
		async (failure) => {
			let resolvePinned!: (value: CodingAgentPinnedModelContext) => void;
			const pending = new Promise<CodingAgentPinnedModelContext>((resolve) => {
				resolvePinned = resolve;
			});
			const extensionRelease = vi.fn();
			const transformRelease = vi.fn();
			const runtime = new CodingAgentContextRuntime({
				hookRuntime: createHookRuntime(),
				resolveApiKey: () => "key",
				bindPinnedModelContext: () => pending,
				extensionRuntime: createExtensionRuntime({
					bindForTurn: async () => createExtensionRuntime({ releaseTurnBinding: extensionRelease }),
				}),
				bindTransformAgentContext: () => ({ transform: async (messages) => messages, release: transformRelease }),
			});
			const controller = new AbortController();
			const binding = runtime.bindForTurn({
				sessionId: "session-1",
				operationId: "manual",
				reason: "manual_compaction",
				signal: controller.signal,
			});
			if (failure === "cancelled") controller.abort();
			resolvePinned({ id: failure === "invalid" ? "" : "valid", records: [] });
			await expect(binding).rejects.toThrow();
			expect(extensionRelease).toHaveBeenCalledOnce();
			expect(transformRelease).toHaveBeenCalledOnce();
		},
	);

	it("keeps manual compaction context, settings and extension hooks isolated from later bindings", async () => {
		let omittedEntry = "event-1";
		let settings = compactingSettings();
		const before = vi.fn(async () => undefined);
		const after = vi.fn(async () => undefined);
		const release = vi.fn();
		const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "private summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: () => settings,
			generateCompaction,
			bindPinnedModelContext: () => ({
				id: omittedEntry,
				records: [],
				conversationProjections: [{ entryId: omittedEntry, kind: "omit-entry" }],
			}),
			extensionRuntime: createExtensionRuntime({
				beforeCompaction: async () => {
					throw new Error("Unbound extension");
				},
				bindForTurn: () =>
					createExtensionRuntime({
						beforeCompaction: before,
						afterCompaction: after,
						releaseTurnBinding: release,
					}),
			}),
		});
		const signal = new AbortController().signal;
		const admission = {
			sessionId: "session-1",
			operationId: "manual-1",
			reason: "manual_compaction" as const,
			signal,
		};
		const first = await runtime.bindForTurn(admission);
		omittedEntry = "event-2";
		settings = { ...settings, keepRecentTokens: 100_000 };
		const second = await runtime.bindForTurn({ ...admission, operationId: "preview", reason: "preview" });
		const document = documentFromMessages([
			userMessage("PUBLIC_IMPORT", 1),
			userMessage("PRIVATE_REQUEST".repeat(40), 2),
			assistantMessage("private answer", 90, 3),
			userMessage("current", 4),
		]);
		const input = { sessionId: "session-1", document, modelBinding: { model: MODEL } };
		try {
			const record = await first.compactManual(input, signal);
			const committed = applyStoredEventToConversationDocument(
				document,
				{
					type: "context.compacted",
					sessionId: "session-1",
					record,
					timestamp: 42,
				},
				document.journalVersion + 1,
			);
			await first.onManualCompactionCommitted?.(record, input, signal, committed);
			expect(generateCompaction).toHaveBeenCalledOnce();
			expect(JSON.stringify(generateCompaction.mock.calls[0])).not.toContain("PUBLIC_IMPORT");
			expect(JSON.stringify(generateCompaction.mock.calls[0])).toContain("PRIVATE_REQUEST");
			expect(before).toHaveBeenCalledOnce();
			expect(after).toHaveBeenCalledOnce();
			expect(document.entries).toHaveLength(4);
		} finally {
			await first.releaseTurnBinding?.();
			await second.releaseTurnBinding?.();
		}
		expect(release).toHaveBeenCalledTimes(2);
	});

	it.each(["automatic", "manual"] as const)(
		"preserves private execution blocks of a published answer during %s compaction",
		async (mode) => {
			const published: AssistantMessage = {
				...assistantMessage("PUBLIC_ANSWER", 90, 2),
				content: [
					{ type: "thinking", thinking: "PRIVATE_REASONING", thinkingSignature: "signature" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file" } },
					{ type: "text", text: "PUBLIC_ANSWER" },
				],
			};
			const history: Message[] = [
				userMessage("private request".repeat(40), 1),
				published,
				{
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "read",
					content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }],
					isError: false,
					timestamp: 3,
				},
				userMessage("current", 4),
			];
			const document = documentFromMessages(history);
			const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
				summary: "private summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			}));
			const runtime = new CodingAgentContextRuntime({
				hookRuntime: createHookRuntime(),
				resolveApiKey: () => "key",
				resolveSettings: compactingSettings,
				generateCompaction,
				bindPinnedModelContext: () => ({
					id: "generation",
					records: [{ type: "public", content: "PUBLIC_ANSWER", timestamp: 2, modelVisible: true }],
					conversationProjections: [{ entryId: "event-2", kind: "omit-assistant-text" }],
				}),
			});
			const signal = new AbortController().signal;
			const bound = await runtime.bindForTurn({
				sessionId: "session-1",
				operationId: "turn-1",
				reason: "turn",
				signal,
			});
			try {
				if (mode === "automatic")
					await bound.prepare(
						{ ...preparationInput(document, history, history, []), reason: "model_call" },
						signal,
					);
				else
					await bound.compactManual({ sessionId: "session-1", document, modelBinding: { model: MODEL } }, signal);
				const preparation = JSON.stringify(generateCompaction.mock.calls[0]);
				expect(preparation).not.toContain("PUBLIC_ANSWER");
				expect(preparation).toContain("PRIVATE_REASONING");
				expect(preparation).toContain("signature");
				expect(preparation).toContain("PRIVATE_TOOL_RESULT");
				expect(preparation).toContain('"type":"toolCall"');
				expect(document.entries.find((entry) => entry.id === "event-2")).toMatchObject({ message: published });
			} finally {
				await bound.releaseTurnBinding?.();
			}
		},
	);

	it("snapshots nested pinned content for the whole Turn and refreshes it on the next Turn", async () => {
		const content = [{ type: "text" as const, text: "shared-v1" }];
		const bind = vi.fn(() => ({
			id: "shared",
			records: [{ type: "public", content, timestamp: 1, modelVisible: true }],
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			bindPinnedModelContext: bind,
		});
		const admission = {
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn" as const,
			signal: new AbortController().signal,
		};
		const first = await runtime.bindForTurn(admission);
		content[0]!.text = "shared-v2";
		const input = {
			sessionId: "session-1",
			turnId: "turn-1",
			messages: [userMessage("current", 2)],
			modelBinding: { model: MODEL },
		};
		expect((await first.transform(input, admission.signal)).map(messageText)).toEqual(["shared-v1", "current"]);
		expect((await first.transform(input, admission.signal)).map(messageText)).toEqual(["shared-v1", "current"]);
		expect(bind).toHaveBeenCalledOnce();
		await first.releaseTurnBinding?.();
		const second = await runtime.bindForTurn({ ...admission, operationId: "turn-2" });
		expect((await second.transform(input, admission.signal)).map(messageText)).toEqual(["shared-v2", "current"]);
		await second.releaseTurnBinding?.();
	});

	it.each(["automatic", "manual"] as const)("keeps pinned public history out of %s compaction", async (mode) => {
		const history = [
			userMessage("PUBLIC_IMPORT", 1),
			userMessage("private request".repeat(40), 2),
			assistantMessage("private response", 90, 3),
			userMessage("current", 4),
		];
		const document = documentFromMessages(history);
		const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "private summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
			bindPinnedModelContext: () => ({
				id: "shared-generation",
				records: [{ type: "public", content: "PUBLIC_IMPORT", timestamp: 1, modelVisible: true }],
				conversationProjections: [{ entryId: "event-1", kind: "omit-entry" }],
			}),
		});
		const signal = new AbortController().signal;
		const bound = await runtime.bindForTurn({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal,
		});
		if (mode === "automatic") {
			const prepared = await bound.prepare(
				{ ...preparationInput(document, history, history, []), reason: "model_call" },
				signal,
			);
			expect(prepared.compaction).toBeDefined();
			expect(prepared.messages.map(messageText).filter((text) => text === "PUBLIC_IMPORT")).toEqual([
				"PUBLIC_IMPORT",
			]);
			expect(messageText(prepared.messages[0]!)).toBe("PUBLIC_IMPORT");
		} else {
			await bound.compactManual({ sessionId: "session-1", document, modelBinding: { model: MODEL } }, signal);
		}
		expect(generateCompaction).toHaveBeenCalledOnce();
		expect(JSON.stringify(generateCompaction.mock.calls[0])).not.toContain("PUBLIC_IMPORT");
		expect(JSON.stringify(generateCompaction.mock.calls[0])).toContain("private request");
		expect(document.entries[0]?.id).toBe("event-1");
		await bound.releaseTurnBinding?.();
	});

	it("rejects invalid pinned context before acquiring extension resources", async () => {
		const bindExtension = vi.fn();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			bindPinnedModelContext: () => ({
				id: "invalid",
				records: [{ type: "hidden", content: "secret", timestamp: 1, modelVisible: false }],
			}),
			extensionRuntime: createExtensionRuntime({ bindForTurn: bindExtension }),
		});
		await expect(
			runtime.bindForTurn({
				sessionId: "session-1",
				operationId: "turn",
				reason: "turn",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("invalid record");
		expect(bindExtension).not.toHaveBeenCalled();
	});

	it("releases an acquired extension binding if the following transform binding fails", async () => {
		const release = vi.fn();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			extensionRuntime: createExtensionRuntime({
				bindForTurn: () => createExtensionRuntime({ releaseTurnBinding: release }),
			}),
			bindTransformAgentContext: () => {
				throw new Error("transform binding failed");
			},
		});
		await expect(
			runtime.bindForTurn({
				sessionId: "session-1",
				operationId: "turn",
				reason: "turn",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("transform binding failed");
		expect(release).toHaveBeenCalledOnce();
	});

	it("releases every binding once even when a cleanup throws synchronously", async () => {
		const releaseTransform = vi.fn();
		const releaseExtension = vi.fn(() => {
			throw new Error("cleanup failed");
		});
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			extensionRuntime: createExtensionRuntime({ releaseTurnBinding: releaseExtension }),
			bindTransformAgentContext: () => ({ transform: async (messages) => messages, release: releaseTransform }),
		});
		const bound = await runtime.bindForTurn({
			sessionId: "session-1",
			operationId: "turn",
			reason: "turn",
			signal: new AbortController().signal,
		});
		await expect(bound.releaseTurnBinding?.()).rejects.toThrow("Failed to release");
		await bound.releaseTurnBinding?.();
		expect(releaseTransform).toHaveBeenCalledOnce();
		expect(releaseExtension).toHaveBeenCalledOnce();
	});

	it("freezes time-based projection decisions for every model call in a Turn", async () => {
		let now = 100_000;
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			now: () => now,
		});
		const bound = await runtime.bindForTurn({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal: new AbortController().signal,
		});
		const messages = [
			...Array.from({ length: 9 }, (_, index) => thinkingAssistantMessage(`thought-${index}`, 80_000 + index)),
			userMessage("current", 90_000),
		];
		const input = {
			sessionId: "session-1",
			turnId: "turn-1",
			messages,
			modelBinding: { model: { ...MODEL, contextWindow: 10_000, maxTokens: 100 } },
		};

		const first = await bound.transform(input, new AbortController().signal);
		now = 200_000;
		const second = await bound.transform(input, new AbortController().signal);

		expect(first).toEqual(second);
		expect(first[0]?.content).toEqual([{ type: "thinking", thinking: "thought-0" }]);
		await bound.releaseTurnBinding?.();
	});

	it("keeps admitted compaction settings for every model call in the Turn", async () => {
		let enabled = true;
		const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: () => ({ ...compactingSettings(), enabled }),
			generateCompaction,
		});
		const bound = await runtime.bindForTurn({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal: new AbortController().signal,
		});
		enabled = false;
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const input = {
			...preparationInput(documentFromMessages(history), history, history, []),
			reason: "model_call" as const,
		};

		const admitted = await bound.prepare(input, new AbortController().signal);
		const nextTurn = await runtime.prepare(input, new AbortController().signal);

		expect(admitted.compaction).toBeDefined();
		expect(nextTurn.compaction).toBeUndefined();
		expect(generateCompaction).toHaveBeenCalledOnce();
		await bound.releaseTurnBinding?.();
	});

	it("passes the admitted summary language to every compaction generation", async () => {
		const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			// 界面语言由宿主经设置端口传入（见 desktop composition）；这里钉住它到得了摘要生成入口。
			resolveSettings: () => ({ ...compactingSettings(), summaryLanguage: "zh" }),
			generateCompaction,
		});
		const history = [
			userMessage("old request".repeat(40), 1),
			assistantMessage("old response", 90, 2),
			userMessage("kept request", 3),
		] satisfies Message[];
		const bound = await runtime.bindForTurn({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal: new AbortController().signal,
		});

		await bound.prepare(
			{
				...preparationInput(documentFromMessages(history), history, history, []),
				reason: "model_call" as const,
			},
			new AbortController().signal,
		);

		expect(generateCompaction).toHaveBeenCalledOnce();
		expect(generateCompaction.mock.calls[0]?.[5]).toMatchObject({ summaryLanguage: "zh" });
		await bound.releaseTurnBinding?.();
	});

	it("does not generate an automatic compaction when the keep-tail policy would retain every message", async () => {
		const history = [
			userMessage("old request", 1),
			assistantMessage("old response", 90, 2),
			userMessage("current input", 3),
		] satisfies Message[];
		const observations: RuntimeSessionObservationEvent[] = [];
		const generateCompaction = vi.fn(async (): Promise<CompactionResult> => {
			throw new Error("must not run");
		});
		const hooks = createHookRuntime();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: hooks,
			resolveApiKey: () => "key",
			resolveSettings: () => ({ ...compactingSettings(), keepRecentTokens: 50_000 }),
			generateCompaction,
		});
		const input: ContextPreparationInput = {
			...preparationInput(documentFromMessages(history), history, history, observations),
			reason: "model_call",
		};

		const prepared = await runtime.prepare(input, new AbortController().signal);

		expect(prepared.compaction).toBeUndefined();
		expect(generateCompaction).not.toHaveBeenCalled();
		expect(hooks.runPreCompact).not.toHaveBeenCalled();
		expect(observations).toMatchObject([
			{ type: "compaction.start", reason: "threshold" },
			{
				type: "compaction.end",
				success: false,
				reason: "threshold",
				errorMessage: "compaction.skipped.noEligiblePrefix",
			},
		]);
	});

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
		expect(observations).toMatchObject([
			{
				type: "compaction.start",
				reason: "threshold",
				contextWindow: 100,
				thresholdTokens: 80,
				source: "agent",
			},
		]);

		const commitResult = await runtime.onCompactionCommitted(
			prepared.compaction!,
			input,
			new AbortController().signal,
		);

		expect(commitResult).toEqual({ continueExecution: true });
		expect(hooks.runPostCompact).toHaveBeenCalledWith("auto", expect.any(AbortSignal));
		expect(hooks.markSessionStart).toHaveBeenCalledWith("compact");
		expect(observations).toMatchObject([{ type: "compaction.start", reason: "threshold", source: "agent" }]);
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

		// 工作状态只进模型可见投影。持久化的 summary 保持人读叙述（UI 压缩卡与下次压缩的
		// previousSummary 都读它，不该看到 JSON）；在飞 todo / 后台任务经 summaryMessage 恢复。
		expect(record.summary).toBe("summary");
		expect(record.summary).not.toContain("<runtime-work-state>");

		const projected = messageText(record.summaryMessage);
		expect(projected.startsWith(COMPACTION_SUMMARY_PREFIX)).toBe(true);
		expect(projected.endsWith(COMPACTION_SUMMARY_SUFFIX)).toBe(true);
		expect(projected).toContain("<runtime-work-state>");
		expect(projected).toContain('"nextTodoId":1');
		expect(projected).toContain('"id":"task-1"');
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
		expect(observations).toMatchObject([
			{ type: "compaction.start", reason: "threshold", contextWindow: 100, thresholdTokens: 80, source: "agent" },
			{
				type: "compaction.end",
				success: false,
				reason: "threshold",
				errorMessage: "compaction.skipped.blockedByHook",
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
		expect(observations).toMatchObject([{ type: "compaction.start", reason: "threshold", source: "agent" }]);
	});

	it("skips a repeated same-turn compaction when the previous one made no progress", async () => {
		const messages = [
			userMessage("x".repeat(480), 1),
			assistantMessage("reply", 90, 2),
			userMessage("kept request", 3),
			toolResultMessage(1),
		] satisfies Message[];
		const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			// 保留段自带 usage 锚点，压缩后仍在阈值之上：这正是同一轮里重复压缩出现的条件。
			resolveSettings: () => ({ ...compactingSettings(), keepRecentTokens: 6 }),
			generateCompaction,
			now: () => 42,
		});
		const document = documentFromMessages(messages);
		const observations: RuntimeSessionObservationEvent[] = [];
		const checkpoint = (current: readonly Message[]): ContextPreparationInput => ({
			...preparationInput(document, current, current, observations),
			reason: "model_call",
		});

		const first = await runtime.prepare(checkpoint(messages), new AbortController().signal);
		expect(first.compaction?.reason).toBe("threshold");
		expect(estimateContextTokens(first.messages).tokens).toBeGreaterThanOrEqual(80);

		const second = await runtime.prepare(checkpoint(first.messages), new AbortController().signal);

		expect(second.compaction).toBeUndefined();
		expect(second.messages).toEqual(first.messages);
		expect(generateCompaction).toHaveBeenCalledTimes(1);
		expect(observations).toMatchObject([
			{ type: "compaction.start", reason: "threshold", source: "agent" },
			{
				type: "compaction.end",
				success: false,
				reason: "threshold",
				errorMessage: "compaction.skipped.noProgress",
				source: "agent",
			},
		]);
	});

	it("compacts again in the same turn once the context grows past the no-progress allowance", async () => {
		const messages = [
			userMessage("x".repeat(480), 1),
			assistantMessage("reply", 90, 2),
			userMessage("kept request", 3),
			toolResultMessage(1),
		] satisfies Message[];
		const generateCompaction = vi.fn(async (preparation: CompactionPreparation) => ({
			summary: "summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: () => ({ ...compactingSettings(), keepRecentTokens: 6 }),
			generateCompaction,
			now: () => 42,
		});
		const document = documentFromMessages(messages);
		const observations: RuntimeSessionObservationEvent[] = [];
		const checkpoint = (current: readonly Message[]): ContextPreparationInput => ({
			...preparationInput(document, current, current, observations),
			reason: "model_call",
		});

		const first = await runtime.prepare(checkpoint(messages), new AbortController().signal);
		expect(first.compaction?.reason).toBe("threshold");

		// 同轮里又读回一段实质内容（超过窗口 5%）：抑制应当让位，允许再次压缩。
		const grown = [...first.messages, userMessage("z".repeat(200), 4)];
		const second = await runtime.prepare(checkpoint(grown), new AbortController().signal);

		expect(second.compaction?.reason).toBe("threshold");
		expect(generateCompaction).toHaveBeenCalledTimes(2);
	});

	/**
	 * 真实会话回归：deepseek-flash（128K 窗口、默认压缩设置）跑一个工具结果密集的长回合。
	 * 线上面板看到的是缓存命中率 71.8%、平均每 1-2 次模型调用就压缩一次。
	 *
	 * provider 的 usage 已经包含系统提示词、技能说明与 41 个工具 schema（合计约 4 万 token），
	 * 逐字口径只看得见消息文本。把两者差额当成喂给模型的「固定开销」再补一次，估算就会长期
	 * 高出真实输入，80k 的真实请求会被判成 130k+，于是刚压缩完又立刻达到压缩线。
	 */
	it("does not compact a large-window model call whose visible text is far below the usage anchor", async () => {
		const history = largeWindowHistory();
		const inFlight = toolResultText(20_000, 42);
		const generateCompaction = compactionSpy();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: largeWindowSettings,
			generateCompaction,
			now: () => 42,
		});
		const observations: RuntimeSessionObservationEvent[] = [];

		const prepared = await runtime.prepare(
			largeWindowInput(history, [...history, inFlight], observations),
			new AbortController().signal,
		);

		// 最后一条 assistant 的 usage（80_885）就是 provider 看到的完整输入，只有其后的在途消息需要逐字补算。
		expect(prepared.estimatedTokens).toBeGreaterThanOrEqual(80_885);
		expect(shouldCompact(prepared.estimatedTokens, BIG_MODEL.contextWindow, largeWindowSettings())).toBe(false);
		expect(prepared.compaction).toBeUndefined();
		expect(prepared.messages).toEqual([...history, inFlight]);
		expect(generateCompaction).not.toHaveBeenCalled();
		expect(observations).toEqual([]);
	});

	it("keeps every model call of one long turn below the threshold and append-only", async () => {
		const history = largeWindowHistory();
		const generateCompaction = compactionSpy();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: largeWindowSettings,
			generateCompaction,
			now: () => 42,
		});
		const observations: RuntimeSessionObservationEvent[] = [];
		const appended: Message[] = [];
		let previous: readonly Message[] = history;

		for (let call = 0; call < 5; call += 1) {
			appended.push(toolResultText(10_000, 100 + call));

			const prepared = await runtime.prepare(
				largeWindowInput(history, [...history, ...appended], observations),
				new AbortController().signal,
			);

			expect(prepared.compaction).toBeUndefined();
			expect(shouldCompact(prepared.estimatedTokens, BIG_MODEL.contextWindow, largeWindowSettings())).toBe(false);
			// 前缀只追加：已经出现过的位置在后续每一次模型调用里都逐字不变。
			expect(prepared.messages.slice(0, previous.length)).toEqual(previous);
			previous = prepared.messages;

			appended.push(
				anchoredAssistantMessage(
					"继续执行",
					{ input: 3_000, cacheRead: 77_885 + 2_500 * call, output: 40 },
					200 + call,
				),
			);
		}

		expect(generateCompaction).not.toHaveBeenCalled();
		expect(observations).toEqual([]);
	});

	it("still compacts when the usage anchor itself is over the threshold", async () => {
		const history = [
			...largeWindowHistory(),
			anchoredAssistantMessage("接近上限", { input: 60_000, cacheRead: 50_000, output: 400 }, 20),
			userMessage("继续", 21),
		];
		const generateCompaction = compactionSpy();
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: largeWindowSettings,
			generateCompaction,
			now: () => 42,
		});

		const prepared = await runtime.prepare(largeWindowInput(history, history, []), new AbortController().signal);

		expect(prepared.compaction?.reason).toBe("threshold");
		expect(generateCompaction).toHaveBeenCalledTimes(1);
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
		expect(observations).toMatchObject([{ type: "compaction.start", reason: "overflow", source: "agent" }]);
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
		expect(observations).toMatchObject([{ type: "compaction.start", reason: "overflow", source: "agent" }]);
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

	it("uses the shared AI authentication contract for manual compaction credential failures", async () => {
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => undefined,
		});
		const result = runtime.compactManual(
			{
				sessionId: "session-1",
				document: documentFromMessages([userMessage("old request".repeat(40), 1), userMessage("kept request", 2)]),
				modelBinding: { model: MODEL },
			},
			new AbortController().signal,
		);

		await expect(result).rejects.toMatchObject({
			code: AI_ERROR_CODES.AUTHENTICATION_FAILED,
			provider: MODEL.provider,
			modelId: MODEL.id,
			retryable: false,
		});
		try {
			await result;
			throw new Error("Expected compaction to reject");
		} catch (error) {
			expect(isAIError(error)).toBe(true);
		}
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

	it("keeps an already reduced model-call prefix stable when the pressure drops within one epoch", async () => {
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
		});
		// 最近的三个真实用户轮受保护，更早的 ToolResult 在软压力下被截断。
		const messages: Message[] = [
			userMessage("goal", 1),
			toolResultText(20_000, 2),
			userMessage("one", 3),
			userMessage("two", 4),
			userMessage("three", 5),
			anchoredAssistantMessage("done", { input: 60, cacheRead: 0, output: 0 }, 6),
		];
		const input = {
			sessionId: "session-1",
			turnId: "turn-1",
			messages,
			modelBinding: { model: MODEL },
		};

		const first = await runtime.transform(input, new AbortController().signal);
		expect(messageText(first[1])).toContain("shortened by context pressure");

		// 下一次调用回报的是已被截断请求的用量，观察到的压力跌破软阈值。若按最新估算重新
		// 决策，这里就会把原文放回去，使刚刚发出的整个前缀失效。
		const grown: Message[] = [
			...messages,
			anchoredAssistantMessage("ack", { input: 30, cacheRead: 0, output: 0 }, 7),
		];
		const second = await runtime.transform({ ...input, messages: grown }, new AbortController().signal);

		expect(second.slice(0, first.length)).toEqual(first);
		expect(messageText(second[1])).toBe(messageText(first[1]));
	});

	it("restarts pressure observation once a compaction is committed", async () => {
		const observations: RuntimeSessionObservationEvent[] = [];
		const generateCompaction = vi.fn(
			async (preparation: CompactionPreparation): Promise<CompactionResult> => ({
				summary: "summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: { source: "test" },
			}),
		);
		const runtime = new CodingAgentContextRuntime({
			hookRuntime: createHookRuntime(),
			resolveApiKey: () => "key",
			resolveSettings: compactingSettings,
			generateCompaction,
			now: () => 42,
		});
		// 最近的三个真实用户轮受保护，更早的 ToolResult 在高压力下被截断。
		const messages: Message[] = [
			userMessage("goal", 1),
			toolResultText(20_000, 2),
			userMessage("one", 3),
			userMessage("two", 4),
			userMessage("three", 5),
			anchoredAssistantMessage("done", { input: 90, cacheRead: 0, output: 0 }, 6),
		];
		const input = {
			sessionId: "session-1",
			turnId: "turn-1",
			messages,
			modelBinding: { model: MODEL },
		};

		const beforeCommit = await runtime.transform(input, new AbortController().signal);
		expect(messageText(beforeCommit[1])).toContain("shortened by context pressure");

		const commitInput: ContextPreparationInput = {
			...preparationInput(documentFromMessages(messages), messages, messages, observations),
			reason: "model_call",
		};
		const prepared = await runtime.prepare(commitInput, new AbortController().signal);
		await runtime.onCompactionCommitted(prepared.compaction!, commitInput, new AbortController().signal);

		// 压缩提交后压力重新观测：新的小上下文不得继续沿用压缩前那一次的高水位，否则同一份
		// 历史工具结果会被永久截短。
		const fresh: Message[] = [
			userMessage("goal", 1),
			toolResultText(20_000, 2),
			userMessage("one", 3),
			userMessage("two", 4),
			userMessage("three", 5),
			anchoredAssistantMessage("done", { input: 40, cacheRead: 0, output: 0 }, 6),
		];
		const afterCommit = await runtime.transform({ ...input, messages: fresh }, new AbortController().signal);

		expect(messageText(afterCommit[1])).not.toContain("shortened by context pressure");
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
		expect(runtime.readUsage(1_000)).toEqual({
			tokens: 125,
			contextWindow: 1_000,
			percent: 12.5,
			thresholdTokens: 800,
		});

		const message = assistantMessage("response", 250, 1);
		const event: StoredSessionEvent = {
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message,
			timestamp: 1,
		};

		await runtime.observe(event, new AbortController().signal);

		expect(runtime.readUsage(1_000)).toEqual({
			tokens: 250,
			contextWindow: 1_000,
			percent: 25,
			thresholdTokens: 800,
		});
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
		reservedOutputTokens: MODEL.maxTokens ?? 0,
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

function createExtensionRuntime(
	overrides: Partial<CodingAgentCompactionExtensionRuntime>,
): CodingAgentCompactionExtensionRuntime {
	return { beforeCompaction: async () => undefined, afterCompaction: async () => undefined, ...overrides };
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

function thinkingAssistantMessage(thinking: string, timestamp: number): AssistantMessage {
	return {
		...assistantMessage("", 1, timestamp),
		content: [{ type: "thinking", thinking }],
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

/**
 * 真实会话的形状：可见文本约 3 万 token，其余 5 万 token 落在逐字口径看不见的固定前缀上
 * （系统提示词 68430 字符 + 技能说明 + 41 个工具 schema），最后一条 assistant 的 usage
 * 就是 provider 在该次请求上回报的真实总量。
 */
function largeWindowHistory(): Message[] {
	const history: Message[] = [
		userMessage("帮我梳理这个仓库的上下文压缩逻辑", 1),
		anchoredAssistantMessage("先看目录", { input: 12_000, cacheRead: 20_000, output: 300 }, 2),
	];
	for (let index = 0; index < 6; index += 1) history.push(toolResultText(20_000, 100 + index));
	history.push(
		anchoredAssistantMessage("读完了", { input: 25_112, cacheRead: 55_680, output: 93 }, 3),
		userMessage("继续", 4),
	);
	return history;
}

function largeWindowInput(
	history: readonly Message[],
	messages: readonly Message[],
	observations: RuntimeSessionObservationEvent[],
): ContextPreparationInput {
	return {
		...preparationInput(documentFromMessages(history), history, messages, observations),
		reason: "model_call",
		modelBinding: { model: BIG_MODEL },
		tokenBudget: BIG_MODEL.contextWindow,
		reservedOutputTokens: BIG_MODEL.maxTokens ?? 0,
	};
}

function largeWindowSettings(): CompactionSettings {
	return { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 5_000 };
}

function compactionSpy() {
	return vi.fn(
		async (preparation: CompactionPreparation): Promise<CompactionResult> => ({
			summary: "summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}),
	);
}

function anchoredAssistantMessage(
	text: string,
	usage: { input: number; cacheRead: number; output: number },
	timestamp: number,
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: BIG_MODEL.api,
		provider: BIG_MODEL.provider,
		model: BIG_MODEL.id,
		usage: {
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: 0,
			totalTokens: usage.input + usage.cacheRead + usage.output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function toolResultText(charCount: number, timestamp: number): Extract<Message, { role: "toolResult" }> {
	return {
		role: "toolResult",
		toolCallId: `call-${timestamp}`,
		toolName: "read",
		content: [{ type: "text", text: "r".repeat(charCount) }],
		isError: false,
		timestamp,
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

/** 与线上一致的窗口：本地声明的 deepseek-flash 没有覆盖 contextWindow，默认 128_000。 */
const BIG_MODEL: Model<Api> = {
	...MODEL,
	id: "deepseek-flash",
	name: "DeepSeek Flash",
	api: "openai-completions",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com/v1",
	contextWindow: 128_000,
	maxTokens: 8_192,
};
