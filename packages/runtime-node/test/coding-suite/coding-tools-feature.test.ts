import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Message, type Model } from "@vetta/ai";
import {
	AgentCoreTurnEngine,
	type AgentProfile,
	FeatureCompiler,
	type IdGenerator,
	PassthroughContextStrategy,
	type RuntimeSnapshot,
	resolveModelCallFrame,
	StaticRuntimeSnapshotProvider,
	type TurnEngineEvent,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	CODING_TOOL_SCOPES,
	type CodingToolActivation,
	type CodingToolCatalog,
	CURRENT_TIME_TOOL_CATEGORY,
	CURRENT_TIME_TOOL_SCOPES,
	createCodingToolsFeature,
	createCurrentTimeTool,
	createCurrentTimeToolRegistration,
	createFindToolRegistration,
	createGlobToolRegistration,
	createGrepToolRegistration,
	createLsToolRegistration,
	createReadToolRegistration,
	InMemoryCodingToolRegistry,
	LS_TOOL_CATEGORY,
	LS_TOOL_SCOPES,
	READ_TOOL_CATEGORY,
	READ_TOOL_SCOPES,
	selectCodingToolRegistrations,
	selectCodingToolsForScope,
	TASK_OUTPUT_TOOL_REQUIRES,
	TASK_OUTPUT_TOOL_SCOPES,
} from "../../src/coding/index.js";

class SnapshotIdGenerator implements IdGenerator {
	next(scope: "snapshot" | "turn"): string {
		return `${scope}-1`;
	}
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
			this.push({
				type: "done",
				reason: message.stopReason,
				message,
			});
		});
	}
}

function model(): Model<"openai-responses"> {
	return {
		id: "recorded-model",
		name: "Recorded Model",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 8_000,
		maxTokens: 1_000,
	};
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "recorded-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason,
		timestamp: 2,
	};
}

function createDefaultRegistry(now: () => Date, cwd = process.cwd()): InMemoryCodingToolRegistry {
	return new InMemoryCodingToolRegistry([
		createCurrentTimeToolRegistration({ now }),
		createReadToolRegistration(cwd),
		createLsToolRegistration(cwd),
	]);
}

function profile(
	catalog: CodingToolCatalog,
	activation: CodingToolActivation = { mode: "scope", scope: "project" },
): AgentProfile {
	return {
		id: "coding",
		instructions: [],
		features: [
			createCodingToolsFeature({
				catalog,
				activation,
			}),
		],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: {
			async authorize(_request, signal) {
				signal.throwIfAborted();
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
	};
}

async function compileSnapshot(now: () => Date, cwd = process.cwd()) {
	return compileCatalogSnapshot(createDefaultRegistry(now, cwd));
}

async function compileCatalogSnapshot(
	catalog: CodingToolCatalog,
	activation: CodingToolActivation = { mode: "scope", scope: "project" },
) {
	const compiler = new FeatureCompiler({
		idGenerator: new SnapshotIdGenerator(),
	});
	return compiler.compile(profile(catalog, activation), new AbortController().signal);
}

async function collectEngineEvents(
	engine: AgentCoreTurnEngine,
	runtimeSnapshot: Awaited<ReturnType<typeof compileSnapshot>>["snapshot"],
): Promise<TurnEngineEvent[]> {
	const events: TurnEngineEvent[] = [];
	for await (const event of engine.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		snapshot: runtimeSnapshot,
		messages: [
			{
				role: "user",
				content: "What time is it?",
				timestamp: 1,
			},
		],
		signal: new AbortController().signal,
	})) {
		events.push(event);
	}
	return events;
}

async function resolveTools(runtimeSnapshot: RuntimeSnapshot): Promise<readonly string[]> {
	const frame = await resolveModelCallFrame(runtimeSnapshot, {
		sessionId: "session-1",
		turnId: "turn-1",
		signal: new AbortController().signal,
	});
	return [...frame.tools.keys()];
}

async function acquireTurnSnapshot(runtimeSnapshot: RuntimeSnapshot, turnId: string) {
	return new StaticRuntimeSnapshotProvider(runtimeSnapshot).acquire({
		sessionId: "session-1",
		operationId: turnId,
		reason: "turn",
		signal: new AbortController().signal,
	});
}

describe("greenfield coding tools feature", () => {
	it("keeps scenario exposure metadata outside the runtime tool definition", () => {
		const registration = createCurrentTimeToolRegistration();
		const readRegistration = createReadToolRegistration(process.cwd());
		const lsRegistration = createLsToolRegistration(process.cwd());
		const projectOnlyRegistration = {
			...registration,
			scopeUse: ["project"] as const,
		};

		expect(registration.category).toBe(CURRENT_TIME_TOOL_CATEGORY);
		expect(registration.scopeUse).toEqual(CURRENT_TIME_TOOL_SCOPES);
		expect(selectCodingToolsForScope([registration], "project").map(({ name }) => name)).toEqual(["current_time"]);
		expect(selectCodingToolsForScope([projectOnlyRegistration], "conversation")).toEqual([]);
		expect(registration.tool).not.toHaveProperty("scopeUse");
		expect(registration.tool).not.toHaveProperty("category");
		expect(readRegistration.category).toBe(READ_TOOL_CATEGORY);
		expect(readRegistration.scopeUse).toEqual(READ_TOOL_SCOPES);
		expect(readRegistration.tool).not.toHaveProperty("scopeUse");
		expect(readRegistration.tool).not.toHaveProperty("category");
		expect(lsRegistration.category).toBe(LS_TOOL_CATEGORY);
		expect(lsRegistration.scopeUse).toEqual(LS_TOOL_SCOPES);
		expect(selectCodingToolsForScope([lsRegistration], "project")).toEqual([]);
		expect(lsRegistration.tool).not.toHaveProperty("scopeUse");
		expect(lsRegistration.tool).not.toHaveProperty("category");
	});

	it("filters required capabilities during scope activation and refreshes them per model call", async () => {
		const capabilities = new Set<string>();
		const baseRegistration = createCurrentTimeToolRegistration();
		const requiredRegistration = {
			...baseRegistration,
			tool: {
				...baseRegistration.tool,
				name: "background_only",
			},
			requires: ["bg-tasks"] as const,
		};
		const registry = new InMemoryCodingToolRegistry([requiredRegistration]);
		const compiled = await compileCatalogSnapshot(registry, {
			mode: "scope",
			scope: "project",
			capabilities,
		});

		try {
			expect(await resolveTools(compiled.snapshot)).toEqual([]);
			capabilities.add("bg-tasks");
			expect(await resolveTools(compiled.snapshot)).toEqual(["background_only"]);
			capabilities.delete("bg-tasks");
			expect(await resolveTools(compiled.snapshot)).toEqual([]);
		} finally {
			await compiled.dispose();
		}
	});

	it("keeps explicit and additionally-enabled tools available without required capabilities", () => {
		const baseRegistration = createCurrentTimeToolRegistration();
		const requiredRegistration = {
			...baseRegistration,
			tool: {
				...baseRegistration.tool,
				name: "background_only",
			},
			requires: ["bg-tasks"] as const,
		};

		expect(selectCodingToolsForScope([requiredRegistration], "project")).toEqual([]);
		expect(
			selectCodingToolRegistrations([requiredRegistration], {
				mode: "scope",
				scope: "project",
				additionallyEnabledToolNames: ["background_only"],
			}).map(({ tool }) => tool.name),
		).toEqual(["background_only"]);
		expect(
			selectCodingToolRegistrations([requiredRegistration], {
				mode: "explicit",
				toolNames: ["background_only"],
			}).map(({ tool }) => tool.name),
		).toEqual(["background_only"]);
	});

	it("requires the background-task capability in every declared task-output scope", () => {
		const baseRegistration = createCurrentTimeToolRegistration();
		const runtimeRegistration = {
			...baseRegistration,
			tool: {
				...baseRegistration.tool,
				name: "task_output",
			},
			scopeUse: TASK_OUTPUT_TOOL_SCOPES,
			requires: TASK_OUTPUT_TOOL_REQUIRES,
		};

		for (const scenario of CODING_TOOL_SCOPES) {
			expect(
				selectCodingToolRegistrations([runtimeRegistration], {
					mode: "scope",
					scope: scenario,
				}).map(({ tool }) => tool.name),
			).toEqual([]);
			expect(
				selectCodingToolRegistrations([runtimeRegistration], {
					mode: "scope",
					scope: scenario,
					capabilities: new Set(["bg-tasks"]),
				}).map(({ tool }) => tool.name),
			).toEqual(TASK_OUTPUT_TOOL_SCOPES.includes(scenario) ? ["task_output"] : []);
		}
	});

	it("provides a deterministic TypeBox-backed current time tool", async () => {
		const tool = createCurrentTimeTool({
			now: () => new Date(2026, 6, 26, 14, 30, 45),
		});

		const result = await tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "tool-call-1",
			input: {
				description: "Check the local time",
			},
			signal: new AbortController().signal,
		});

		expect(result).toEqual({
			content: [{ type: "text", text: "2026-07-26 14:30:45" }],
			details: { timestamp: "2026-07-26 14:30:45" },
		});
		expect(tool.inputSchema).toMatchObject({
			type: "object",
			properties: {
				description: {
					type: "string",
					maxLength: 100,
				},
			},
		});
		expect(tool.inputSchema).not.toHaveProperty("additionalProperties");
	});

	it("preserves the legacy current-time behavior for an already-aborted direct call", async () => {
		let invocationCount = 0;
		const tool = createCurrentTimeTool({
			now() {
				invocationCount += 1;
				return new Date(2026, 6, 26, 14, 30, 45);
			},
		});
		const controller = new AbortController();
		controller.abort();

		const result = await tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "tool-call-1",
			input: {},
			signal: controller.signal,
		});

		expect(invocationCount).toBe(1);
		expect(result.content).toEqual([{ type: "text", text: "2026-07-26 14:30:45" }]);
	});

	it("runs the compiled feature through the real agent-core tool loop", async () => {
		const compiled = await compileSnapshot(() => new Date(2026, 6, 26, 14, 30, 45));
		const responses = [
			assistantMessage([{ type: "toolCall", id: "tool-call-1", name: "current_time", arguments: {} }], "toolUse"),
			assistantMessage([{ type: "text", text: "It is 14:30:45." }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collectEngineEvents(engine, compiled.snapshot);
		const messages = events
			.filter((event): event is Extract<TurnEngineEvent, { type: "message" }> => event.type === "message")
			.map(({ message }) => message);
		const toolResult = messages.find(
			(message): message is Extract<Message, { role: "toolResult" }> => message.role === "toolResult",
		);

		expect(await resolveTools(compiled.snapshot)).toEqual(["current_time", "read"]);
		expect(toolResult).toMatchObject({
			isError: false,
			content: [{ type: "text", text: "2026-07-26 14:30:45" }],
			details: { timestamp: "2026-07-26 14:30:45" },
		});
		expect(events.at(-1)).toEqual({
			type: "completed",
			stopReason: "stop",
		});
		await compiled.dispose();
	});

	it("runs read through the compiled feature and real agent-core tool loop", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-feature-read-"));
		try {
			writeFileSync(join(directory, "message.txt"), "hello from read");
			const compiled = await compileSnapshot(() => new Date(2026, 6, 26, 14, 30, 45), directory);
			const responses = [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "tool-call-read",
							name: "read",
							arguments: { path: "message.txt" },
						},
					],
					"toolUse",
				),
				assistantMessage([{ type: "text", text: "Read complete." }]),
			];
			let responseIndex = 0;
			const engine = new AgentCoreTurnEngine({
				model: model(),
				streamFn: () => {
					const response = responses[responseIndex];
					responseIndex += 1;
					if (!response) throw new Error("Missing recorded response");
					return new RecordedAssistantStream(response);
				},
			});

			const events = await collectEngineEvents(engine, compiled.snapshot);
			const toolResult = events.find(
				(
					event,
				): event is Extract<TurnEngineEvent, { type: "message" }> & {
					readonly message: Extract<Message, { role: "toolResult" }>;
				} => event.type === "message" && event.message.role === "toolResult",
			)?.message;

			expect(toolResult).toMatchObject({
				isError: false,
				content: [{ type: "text", text: expect.stringMatching(/^1:[0-9a-z]{4}→hello from read$/) }],
			});
			await compiled.dispose();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("keeps catalog membership stable within a Turn and refreshes the next Turn", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-feature-catalog-"));
		try {
			const registry = new InMemoryCodingToolRegistry([
				createCurrentTimeToolRegistration({
					now: () => new Date(2026, 6, 26, 14, 30, 45),
				}),
				createReadToolRegistration(directory),
			]);
			const compiled = await compileCatalogSnapshot(registry);

			expect(compiled.snapshot.modelCallProviders?.[0]?.bindForTurn).toBeTypeOf("function");
			const firstTurn = await acquireTurnSnapshot(compiled.snapshot, "turn-1");
			expect(firstTurn.snapshot).not.toBe(compiled.snapshot);
			expect(await resolveTools(firstTurn.snapshot)).toEqual(["current_time", "read"]);
			expect(registry.unregister("read")).toBe(true);
			registry.register({
				...createLsToolRegistration(directory),
				scopeUse: ["project"],
			});

			expect(await resolveTools(firstTurn.snapshot)).toEqual(["current_time", "read"]);
			await firstTurn.release();
			const secondTurn = await acquireTurnSnapshot(compiled.snapshot, "turn-2");
			expect(await resolveTools(secondTurn.snapshot)).toEqual(["current_time", "ls"]);
			await secondTurn.release();
			expect(compiled.snapshot.id).toBe("snapshot-1");
			await compiled.dispose();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("lets an advertised binding finish after ordinary removal and keeps the Turn catalog stable", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-feature-live-removal-"));
		try {
			writeFileSync(join(directory, "message.txt"), "must not be read");
			const registry = new InMemoryCodingToolRegistry([
				createCurrentTimeToolRegistration(),
				createReadToolRegistration(directory),
			]);
			const compiled = await compileCatalogSnapshot(registry);
			const advertisedTools: string[][] = [];
			let responseIndex = 0;
			const engine = new AgentCoreTurnEngine({
				model: model(),
				streamFn: (_model, context) => {
					advertisedTools.push((context.tools ?? []).map(({ name }) => name));
					if (responseIndex === 0) {
						expect(registry.unregister("read")).toBe(true);
					}
					const response =
						responseIndex === 0
							? assistantMessage(
									[
										{
											type: "toolCall",
											id: "tool-call-read",
											name: "read",
											arguments: { path: "message.txt" },
										},
									],
									"toolUse",
								)
							: assistantMessage([{ type: "text", text: "Read was removed." }]);
					responseIndex += 1;
					return new RecordedAssistantStream(response);
				},
			});

			const turn = await acquireTurnSnapshot(compiled.snapshot, "turn-1");
			const events = await collectEngineEvents(engine, turn.snapshot);
			await turn.release();
			const toolResult = events.find(
				(
					event,
				): event is Extract<TurnEngineEvent, { type: "message" }> & {
					readonly message: Extract<Message, { role: "toolResult" }>;
				} => event.type === "message" && event.message.role === "toolResult",
			)?.message;

			expect(advertisedTools).toEqual([
				["current_time", "read"],
				["current_time", "read"],
			]);
			expect(toolResult).toMatchObject({
				isError: false,
				content: [{ type: "text", text: expect.stringContaining("must not be read") }],
			});
			await compiled.dispose();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("runs an explicitly selected ls tool through the real agent-core tool loop", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-feature-ls-"));
		try {
			writeFileSync(join(directory, "alpha.txt"), "alpha");
			const compiled = await compileCatalogSnapshot(
				createDefaultRegistry(() => new Date(), directory),
				{
					mode: "explicit",
					toolNames: ["ls"],
				},
			);
			const responses = [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "tool-call-ls",
							name: "ls",
							arguments: { path: "." },
						},
					],
					"toolUse",
				),
				assistantMessage([{ type: "text", text: "List complete." }]),
			];
			let responseIndex = 0;
			const engine = new AgentCoreTurnEngine({
				model: model(),
				streamFn: () => {
					const response = responses[responseIndex];
					responseIndex += 1;
					if (!response) throw new Error("Missing recorded response");
					return new RecordedAssistantStream(response);
				},
			});

			const events = await collectEngineEvents(engine, compiled.snapshot);
			const toolResult = events.find(
				(
					event,
				): event is Extract<TurnEngineEvent, { type: "message" }> & {
					readonly message: Extract<Message, { role: "toolResult" }>;
				} => event.type === "message" && event.message.role === "toolResult",
			)?.message;

			expect(toolResult).toMatchObject({
				isError: false,
				content: [{ type: "text", text: "alpha.txt" }],
			});
			expect(await resolveTools(compiled.snapshot)).toEqual(["ls"]);
			await compiled.dispose();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("runs the migrated grep tool through the real agent-core tool loop", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-feature-grep-"));
		try {
			writeFileSync(join(directory, "message.txt"), "before\nneedle line\nafter");
			const registry = new InMemoryCodingToolRegistry([createGrepToolRegistration(directory, { rgPath: "rg" })]);
			const compiled = await compileCatalogSnapshot(registry);
			const responses = [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "tool-call-grep",
							name: "grep",
							arguments: { pattern: "needle", path: "message.txt" },
						},
					],
					"toolUse",
				),
				assistantMessage([{ type: "text", text: "Search complete." }]),
			];
			let responseIndex = 0;
			const engine = new AgentCoreTurnEngine({
				model: model(),
				streamFn: () => {
					const response = responses[responseIndex];
					responseIndex += 1;
					if (!response) throw new Error("Missing recorded response");
					return new RecordedAssistantStream(response);
				},
			});

			const events = await collectEngineEvents(engine, compiled.snapshot);
			const toolResult = events.find(
				(
					event,
				): event is Extract<TurnEngineEvent, { type: "message" }> & {
					readonly message: Extract<Message, { role: "toolResult" }>;
				} => event.type === "message" && event.message.role === "toolResult",
			)?.message;

			expect(await resolveTools(compiled.snapshot)).toEqual(["grep"]);
			expect(toolResult).toMatchObject({
				isError: false,
				content: [{ type: "text", text: expect.stringMatching(/^message\.txt:2:[0-9a-z]{4}: needle line$/) }],
			});
			await compiled.dispose();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("runs the migrated find tool through explicit activation and the real agent-core tool loop", async () => {
		const registry = new InMemoryCodingToolRegistry([
			createFindToolRegistration("C:/workspace", {
				operations: {
					exists: () => true,
					glob: () => ["C:/workspace/src/index.ts", "C:/workspace/test/index.test.ts"],
				},
			}),
		]);
		const compiled = await compileCatalogSnapshot(registry, {
			mode: "explicit",
			toolNames: ["find"],
		});
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "tool-call-find",
						name: "find",
						arguments: { pattern: "**/*.ts", path: "." },
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "Search complete." }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collectEngineEvents(engine, compiled.snapshot);
		const toolResult = events.find(
			(
				event,
			): event is Extract<TurnEngineEvent, { type: "message" }> & {
				readonly message: Extract<Message, { role: "toolResult" }>;
			} => event.type === "message" && event.message.role === "toolResult",
		)?.message;

		expect(await resolveTools(compiled.snapshot)).toEqual(["find"]);
		expect(toolResult).toMatchObject({
			isError: false,
			content: [{ type: "text", text: "src/index.ts\ntest/index.test.ts" }],
		});
		await compiled.dispose();
	});

	it("runs the migrated glob tool through explicit activation and the real agent-core tool loop", async () => {
		const registry = new InMemoryCodingToolRegistry([
			createGlobToolRegistration("C:/workspace", {
				operations: {
					isDirectory: () => true,
					glob: (pattern, cwd, options) => {
						expect(pattern).toBe("**/*.ts");
						expect(cwd.replace(/\\/g, "/")).toBe("C:/workspace");
						expect(options.limit).toBe(100);
						return ["C:/workspace/src/index.ts", "C:/workspace/test/index.test.ts"];
					},
				},
			}),
		]);
		const compiled = await compileCatalogSnapshot(registry, {
			mode: "explicit",
			toolNames: ["glob"],
		});
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "tool-call-glob",
						name: "glob",
						arguments: { pattern: "**/*.ts", path: "." },
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "Search complete." }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collectEngineEvents(engine, compiled.snapshot);
		const toolResult = events.find(
			(
				event,
			): event is Extract<TurnEngineEvent, { type: "message" }> & {
				readonly message: Extract<Message, { role: "toolResult" }>;
			} => event.type === "message" && event.message.role === "toolResult",
		)?.message;

		expect(await resolveTools(compiled.snapshot)).toEqual(["glob"]);
		expect(toolResult).toMatchObject({
			isError: false,
			content: [{ type: "text", text: "src/index.ts\ntest/index.test.ts" }],
			details: {
				numFiles: 2,
			},
		});
		await compiled.dispose();
	});

	it("preserves the legacy schema behavior for additional model arguments", async () => {
		let invocationCount = 0;
		const compiled = await compileSnapshot(() => {
			invocationCount += 1;
			return new Date(2026, 6, 26, 14, 30, 45);
		});
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "tool-call-1",
						name: "current_time",
						arguments: { unexpected: true },
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "It is 14:30:45." }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collectEngineEvents(engine, compiled.snapshot);
		const toolResult = events.find(
			(
				event,
			): event is Extract<TurnEngineEvent, { type: "message" }> & {
				readonly message: Extract<Message, { role: "toolResult" }>;
			} => event.type === "message" && event.message.role === "toolResult",
		)?.message;

		expect(invocationCount).toBe(1);
		expect(toolResult).toMatchObject({
			isError: false,
			content: [{ type: "text", text: "2026-07-26 14:30:45" }],
		});
		await compiled.dispose();
	});
});
