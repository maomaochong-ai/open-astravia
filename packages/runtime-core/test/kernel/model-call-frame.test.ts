import { describe, expect, it } from "vitest";
import {
	FeatureCompiler,
	type IdGenerator,
	type ModelCallFrameCompositionContext,
	PassthroughContextStrategy,
	type RuntimeCapabilityDefinition,
	type RuntimeToolDefinition,
	resolveModelCallFrame,
} from "../../src/kernel/index.js";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "../../src/observation/index.js";

class SnapshotIdGenerator implements IdGenerator {
	next(scope: "snapshot" | "turn"): string {
		return `${scope}-1`;
	}
}

describe("model call frame", () => {
	it("refreshes dynamic contributions without recompiling feature instances", async () => {
		let prompt = "dynamic-v1";
		let prepareCount = 0;
		let featureContributionCount = 0;
		let callContributionCount = 0;
		const definition: RuntimeCapabilityDefinition = {
			instructions: [{ id: "base", content: "base", priority: 100 }],
			features: [
				{
					id: "dynamic-instructions",
					async prepare() {
						prepareCount += 1;
						return {
							async contribute() {
								featureContributionCount += 1;
								return {
									modelCallProviders: [
										{
											id: "dynamic-instructions",
											async contribute(context) {
												context.signal.throwIfAborted();
												callContributionCount += 1;
												return {
													instructions: [{ id: "dynamic", content: prompt, priority: 10 }],
												};
											},
										},
									],
								};
							},
							async dispose() {},
						};
					},
				},
			],
			contextStrategy: new PassthroughContextStrategy(),
			toolPolicy: {
				async authorize() {
					return true;
				},
			},
			tokenBudget: 8_000,
			reservedOutputTokens: 1_000,
		};
		const compiled = await new FeatureCompiler({
			idGenerator: new SnapshotIdGenerator(),
		}).compile(definition, new AbortController().signal);

		const first = await resolve(compiled.snapshot);
		prompt = "dynamic-v2";
		const second = await resolve(compiled.snapshot);

		expect(first.instructions.map(({ content }) => content)).toEqual(["dynamic-v1", "base"]);
		expect(second.instructions.map(({ content }) => content)).toEqual(["dynamic-v2", "base"]);
		expect(compiled.snapshot.id).toBe("snapshot-1");
		expect(prepareCount).toBe(1);
		expect(featureContributionCount).toBe(1);
		expect(callContributionCount).toBe(2);
		expect(first.systemPromptStableLength).toBe(0);
		expect(first.promptCacheSystemPromptBlocks?.map(({ cacheability }) => cacheability)).toEqual([
			"volatile",
			"volatile",
		]);
		expect(Object.isFrozen(second)).toBe(true);
		expect(Object.isFrozen(second.instructions)).toBe(true);
		await compiled.dispose();
	});

	it("runs one capability composer after contributions with the current messages and frozen candidate frame", async () => {
		const contexts: ModelCallFrameCompositionContext[] = [];
		const tool: RuntimeToolDefinition = {
			name: "read",
			label: "Read",
			description: "Read a file",
			inputSchema: { type: "object" },
			async execute() {
				return { content: [] };
			},
		};
		const definition: RuntimeCapabilityDefinition = {
			instructions: [{ id: "base", content: "base", priority: 100 }],
			features: [
				{
					id: "dynamic",
					async prepare() {
						return {
							async contribute() {
								return {
									modelCallProviders: [
										{
											id: "dynamic",
											async contribute() {
												return {
													instructions: [{ id: "dynamic", content: "dynamic", priority: 10 }],
													tools: [tool],
												};
											},
										},
									],
								};
							},
							async dispose() {},
						};
					},
				},
			],
			modelCallFrameComposer: {
				async compose(context) {
					contexts.push(context);
					return {
						instructions: [{ id: "final", content: "final prompt", priority: 0 }],
						tools: context.frame.tools,
					};
				},
			},
			contextStrategy: new PassthroughContextStrategy(),
			toolPolicy: {
				async authorize() {
					return true;
				},
			},
			tokenBudget: 8_000,
			reservedOutputTokens: 1_000,
		};
		const compiled = await new FeatureCompiler({
			idGenerator: new SnapshotIdGenerator(),
		}).compile(definition, new AbortController().signal);
		const messages = [{ role: "user" as const, content: "hello", timestamp: 1 }];

		const frame = await resolveModelCallFrame(compiled.snapshot, {
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			messages,
		});

		expect(contexts).toHaveLength(1);
		expect(contexts[0]?.messages).toEqual(messages);
		expect(contexts[0]?.frame.instructions.map(({ id }) => id)).toEqual(["dynamic", "base"]);
		expect(contexts[0]?.frame.tools.get("read")?.description).toBe("Read a file");
		expect(frame.instructions.map(({ content }) => content)).toEqual(["final prompt"]);
		expect([...frame.tools.keys()]).toEqual(["read"]);
		expect(Object.isFrozen(frame.instructions)).toBe(true);
		expect(Object.isFrozen(frame.tools.get("read")?.inputSchema)).toBe(true);
		await compiled.dispose();
	});

	it("orders tools by generic model order and preserves contribution order for dynamic tools", async () => {
		const ordered = await resolveModelCallFrame(
			{
				id: "snapshot-1",
				instructions: [],
				tools: new Map(),
				modelCallProviders: [
					{
						id: "tools",
						async contribute() {
							return {
								tools: [tool("plugin-first"), tool("late", 200), tool("early", 100), tool("plugin-second")],
							};
						},
					},
				],
				contextProviders: [],
				contextStrategy: new PassthroughContextStrategy(),
				toolPolicy: {
					async authorize() {
						return true;
					},
				},
				tokenBudget: 8_000,
				reservedOutputTokens: 1_000,
				observers: [],
			},
			{ sessionId: "session-1", turnId: "turn-1", signal: new AbortController().signal },
		);

		expect([...ordered.tools.keys()]).toEqual(["early", "late", "plugin-first", "plugin-second"]);
	});

	it("passes the composer's system prompt cache breakpoint through to the frozen frame", async () => {
		const frame = await resolve(composerSnapshot(11));

		expect(frame.systemPromptStableLength).toBe(11);
		expect(frame.promptCacheSystemPromptBlocks).toEqual([
			{ id: "stable", start: 0, length: 11, cacheability: "stable" },
		]);
		expect(Object.isFrozen(frame.promptCacheSystemPromptBlocks)).toBe(true);
		expect(Object.isFrozen(frame.promptCacheSystemPromptBlocks?.[0])).toBe(true);
		expect(Object.isFrozen(frame)).toBe(true);
	});

	it("leaves the cache breakpoint undefined when the composer declares none", async () => {
		expect((await resolve(composerSnapshot(undefined))).systemPromptStableLength).toBeUndefined();
	});

	it("automatically caches a basic Agent prompt without requiring a composer", async () => {
		const frame = await resolve({
			...baseSnapshot(),
			instructions: [{ id: "base", content: "base prompt", priority: 100 }],
		});

		expect(frame.systemPromptStableLength).toBe("base prompt".length);
		expect(frame.promptCacheSystemPromptBlocks).toEqual([
			{ id: "base", start: 0, length: "base prompt".length, cacheability: "stable" },
		]);
	});

	it("automatically keeps model-call contributions in a volatile tail", async () => {
		const frame = await resolve({
			...baseSnapshot(),
			instructions: [{ id: "base", content: "base prompt", priority: 0 }],
			modelCallProviders: [
				{
					id: "dynamic",
					async contribute() {
						return { instructions: [{ id: "dynamic", content: "dynamic tail", priority: 100 }] };
					},
				},
			],
		});

		expect(frame.systemPromptStableLength).toBe("base prompt".length);
		expect(frame.promptCacheSystemPromptBlocks).toEqual([
			{ id: "base", start: 0, length: "base prompt".length, cacheability: "stable" },
			{
				id: "dynamic",
				start: "base prompt\n\n".length,
				length: "dynamic tail".length,
				cacheability: "volatile",
			},
		]);
	});

	it("lets a composer opt into automatic layout with instruction cacheability", async () => {
		const frame = await resolve({
			...baseSnapshot(),
			modelCallFrameComposer: {
				async compose() {
					return {
						instructions: [
							{ id: "stable", content: "stable", priority: 0, cacheability: "stable" },
							{ id: "tail", content: "tail", priority: 10 },
						],
						tools: new Map(),
					};
				},
			},
		});

		expect(frame.systemPromptStableLength).toBe("stable".length);
		expect(frame.promptCacheSystemPromptBlocks?.map(({ cacheability }) => cacheability)).toEqual([
			"stable",
			"volatile",
		]);
	});

	it("degrades invalid composer cache metadata to an uncached prompt", async () => {
		const frame = await resolve(composerSnapshot(999));

		expect(frame.systemPromptStableLength).toBe(0);
		expect(frame.promptCacheSystemPromptBlocks).toBeUndefined();
	});

	it("observes malformed cache metadata as a safe warning", async () => {
		const records: RuntimeObservationRecord[] = [];
		const frame = await resolve({
			...composerSnapshot(999),
			observationPublisher: createRuntimeObservationPublisher({
				port: {
					record(record) {
						records.push(record);
					},
				},
			}),
		});

		expect(frame.systemPromptStableLength).toBe(0);
		expect(records.map(({ token }) => token.id)).toEqual([
			"runtime.prompt.frame",
			"runtime.prompt.cache-layout-issue",
			"runtime.prompt.frame",
		]);
		expect(records[1]?.payload).toEqual({
			reason: "invalid-stable-length",
			declaredBlockCount: 1,
			stableLengthDeclared: true,
		});
		expect(records[2]?.payload).toMatchObject({ cacheLayoutSource: "degraded", stableCharacterCount: 0 });
	});

	it("observes prompt and tool boundaries without capturing prompt, arguments, results or error messages", async () => {
		const records: RuntimeObservationRecord[] = [];
		const observationPublisher = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					records.push(record);
				},
			},
		});
		const secretTool: RuntimeToolDefinition = {
			name: "safe_tool_name",
			label: "Safe tool",
			description: "Safe description",
			inputSchema: { type: "object" },
			execute: async () => ({
				content: [{ type: "text", text: "secret-result-value" }],
				details: { private: "secret-details-value" },
			}),
		};
		const failingTool: RuntimeToolDefinition = {
			...secretTool,
			name: "failing_tool",
			execute: async () => {
				throw new Error("secret-error-message");
			},
		};
		const frame = await resolveModelCallFrame(
			{
				...baseSnapshot(),
				instructions: [{ id: "secret", content: "secret-prompt-value", priority: 0 }],
				tools: new Map([
					[secretTool.name, secretTool],
					[failingTool.name, failingTool],
				]),
				observationPublisher,
			},
			{ sessionId: "session-1", turnId: "turn-1", signal: new AbortController().signal },
		);
		const request = {
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "tool-call-1",
			input: { credential: "secret-input-value" },
			signal: new AbortController().signal,
		};

		await expect(frame.tools.get(secretTool.name)?.execute(request)).resolves.toMatchObject({ content: [{}] });
		await expect(frame.tools.get(failingTool.name)?.execute(request)).rejects.toThrow("secret-error-message");

		expect(records.map(({ token, payload }) => [token.id, (payload as { phase?: string }).phase])).toEqual([
			["runtime.prompt.frame", "started"],
			["runtime.prompt.frame", "completed"],
			["runtime.tool.execution", "started"],
			["runtime.tool.execution", "completed"],
			["runtime.tool.execution", "started"],
			["runtime.tool.execution", "failed"],
		]);
		expect(records[1]?.payload).toMatchObject({
			cacheLayoutSource: "automatic",
			stableCharacterCount: "secret-prompt-value".length,
			stableBlockCount: 1,
			volatileBlockCount: 0,
		});
		const serialized = JSON.stringify(records);
		for (const secret of [
			"secret-prompt-value",
			"secret-input-value",
			"secret-result-value",
			"secret-details-value",
			"secret-error-message",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});
});

function baseSnapshot(): Parameters<typeof resolveModelCallFrame>[0] {
	return {
		id: "snapshot-1",
		instructions: [],
		tools: new Map(),
		modelCallProviders: [],
		contextProviders: [],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: {
			async authorize() {
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
}

function composerSnapshot(systemPromptStableLength: number | undefined): Parameters<typeof resolveModelCallFrame>[0] {
	return {
		...baseSnapshot(),
		modelCallFrameComposer: {
			async compose() {
				return {
					instructions: [{ id: "final", content: "stable part\n\nvolatile", priority: 0 }],
					tools: new Map(),
					systemPromptStableLength,
					promptCacheSystemPromptBlocks:
						systemPromptStableLength === undefined
							? undefined
							: [{ id: "stable", start: 0, length: 11, cacheability: "stable" }],
				};
			},
		},
	};
}

function resolve(snapshot: Parameters<typeof resolveModelCallFrame>[0]) {
	return resolveModelCallFrame(snapshot, {
		sessionId: "session-1",
		turnId: "turn-1",
		signal: new AbortController().signal,
	});
}

function tool(name: string, modelOrder?: number): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		modelOrder,
		async execute() {
			return { content: [] };
		},
	};
}
