import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	createCodingToolsFeature,
	createCurrentTimeToolRegistration,
	InMemoryCodingToolRegistry,
} from "../../src/coding/index.js";

describe("coding tools dynamic activation", () => {
	it("resolves activation from each model-call input without rebuilding the feature", async () => {
		const regular = createCurrentTimeToolRegistration();
		const knowledgeOnly = {
			...regular,
			tool: { ...regular.tool, name: "knowledge_only" },
			requires: ["knowledge"] as const,
		};
		const registry = new InMemoryCodingToolRegistry([regular, knowledgeOnly]);
		const resolveActivation = vi.fn((context: ModelCallContributionContext) => ({
			mode: "scope" as const,
			scope: "cli" as const,
			capabilities: new Set(
				context.input?.context?.some(({ type }) => type === "knowledge_mode_instruction") ? ["knowledge"] : [],
			),
		}));
		const definition = createCodingToolsFeature({
			catalog: registry,
			resolveActivation,
		});
		const signal = new AbortController().signal;
		const feature = await definition.prepare({ signal });
		const contribution = await feature.contribute({ profileId: "coding", signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Expected coding tools model-call provider");

		try {
			const normal = await provider.contribute(modelCallContext(signal));
			const knowledge = await provider.contribute(
				modelCallContext(signal, {
					type: "knowledge_mode_instruction",
					content: "knowledge enabled",
					modelVisible: true,
				}),
			);

			expect(normal.tools?.map(({ name }) => name)).toEqual(["current_time"]);
			expect(knowledge.tools?.map(({ name }) => name)).toEqual(["current_time", "knowledge_only"]);
			expect(resolveActivation).toHaveBeenCalledTimes(2);
		} finally {
			await feature.dispose();
		}
	});

	it("applies call-level hard isolation after explicit activation", async () => {
		const knowledgeTool = {
			...createCurrentTimeToolRegistration(),
			tool: { ...createCurrentTimeToolRegistration().tool, name: "knowledge_only" },
			category: "kb-read" as const,
		};
		const registry = new InMemoryCodingToolRegistry([knowledgeTool]);
		const definition = createCodingToolsFeature({
			catalog: registry,
			activation: { mode: "explicit", toolNames: ["knowledge_only"] },
			filterRegistration: (registration, context) =>
				registration.category !== "kb-read" ||
				context.input?.context?.some(({ type }) => type === "knowledge_mode_instruction") === true,
		});
		const signal = new AbortController().signal;
		const feature = await definition.prepare({ signal });
		const contribution = await feature.contribute({ profileId: "coding", signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Expected coding tools model-call provider");

		try {
			expect((await provider.contribute(modelCallContext(signal))).tools).toEqual([]);
			expect(
				(
					await provider.contribute(
						modelCallContext(signal, {
							type: "knowledge_mode_instruction",
							content: "knowledge enabled",
							modelVisible: true,
						}),
					)
				).tools?.map(({ name }) => name),
			).toEqual(["knowledge_only"]);
		} finally {
			await feature.dispose();
		}
	});

	it("filters mode-specific tools at each model-call boundary", async () => {
		const regular = createCurrentTimeToolRegistration();
		const workOnly = {
			...regular,
			tool: { ...regular.tool, name: "work_only" },
			agentModes: ["work"] as const,
		};
		const registry = new InMemoryCodingToolRegistry([regular, workOnly]);
		let agentMode = "work";
		const definition = createCodingToolsFeature({
			catalog: registry,
			resolveActivation: () => ({ mode: "scope", scope: "cli", agentMode }),
		});
		const signal = new AbortController().signal;
		const feature = await definition.prepare({ signal });
		const contribution = await feature.contribute({ profileId: "coding", signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Expected coding tools model-call provider");

		try {
			expect((await provider.contribute(modelCallContext(signal))).tools?.map(({ name }) => name)).toEqual([
				"current_time",
				"work_only",
			]);
			agentMode = "coding";
			expect((await provider.contribute(modelCallContext(signal))).tools?.map(({ name }) => name)).toEqual([
				"current_time",
			]);
		} finally {
			await feature.dispose();
		}
	});
});

function modelCallContext(
	signal: AbortSignal,
	context?: {
		readonly type: string;
		readonly content: string;
		readonly modelVisible: boolean;
	},
): ModelCallContributionContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		signal,
		input: {
			message: {
				role: "user",
				content: "test",
				timestamp: 1,
			},
			...(context ? { context: [context] } : {}),
		},
	};
}
