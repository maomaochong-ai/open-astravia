import { describe, expect, it } from "vitest";
import {
	type AgentProfile,
	FeatureCompiler,
	type IdGenerator,
	type ModelCallFrameCompositionContext,
	PassthroughContextStrategy,
	type RuntimeToolDefinition,
	resolveModelCallFrame,
} from "../../src/kernel/index.js";

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
		const profile: AgentProfile = {
			id: "coding",
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
		}).compile(profile, new AbortController().signal);

		const first = await resolve(compiled.snapshot);
		prompt = "dynamic-v2";
		const second = await resolve(compiled.snapshot);

		expect(first.instructions.map(({ content }) => content)).toEqual(["dynamic-v1", "base"]);
		expect(second.instructions.map(({ content }) => content)).toEqual(["dynamic-v2", "base"]);
		expect(compiled.snapshot.id).toBe("snapshot-1");
		expect(prepareCount).toBe(1);
		expect(featureContributionCount).toBe(1);
		expect(callContributionCount).toBe(2);
		expect(Object.isFrozen(second)).toBe(true);
		expect(Object.isFrozen(second.instructions)).toBe(true);
		await compiled.dispose();
	});

	it("runs one profile composer after contributions with the current messages and frozen candidate frame", async () => {
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
		const profile: AgentProfile = {
			id: "coding",
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
		}).compile(profile, new AbortController().signal);
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
});

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
