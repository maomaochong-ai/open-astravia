import { describe, expect, it } from "vitest";
import {
	createDefaultRuntimeCapabilityDefinition,
	DEFAULT_RUNTIME_RESERVED_OUTPUT_TOKENS,
	DEFAULT_RUNTIME_TOKEN_BUDGET,
} from "../../src/kernel/index.js";

describe("createDefaultRuntimeCapabilityDefinition", () => {
	it("creates an explicit safe baseline without a hidden Agent execution path", async () => {
		const definition = createDefaultRuntimeCapabilityDefinition();
		const signal = new AbortController().signal;

		expect(definition.instructions).toEqual([]);
		expect(definition.features).toEqual([]);
		expect(definition.tokenBudget).toBe(DEFAULT_RUNTIME_TOKEN_BUDGET);
		expect(definition.reservedOutputTokens).toBe(DEFAULT_RUNTIME_RESERVED_OUTPUT_TOKENS);
		await expect(
			definition.toolPolicy.authorize(
				{ sessionId: "session-1", turnId: "turn-1", toolName: "unsafe", input: {} },
				signal,
			),
		).resolves.toBe(false);
		await expect(
			definition.contextStrategy.prepare(
				{
					sessionId: "session-1",
					turnId: "turn-1",
					messages: [{ role: "user", content: "hello", timestamp: 1 }],
					historyMessages: [],
					tokenBudget: definition.tokenBudget,
					reservedOutputTokens: definition.reservedOutputTokens,
					reportObservation: async () => {},
				},
				signal,
			),
		).resolves.toMatchObject({ messages: [{ role: "user", content: "hello" }] });
	});

	it("copies collection overrides and preserves ordinary capability overrides", async () => {
		const instructions = [{ id: "base", content: "stable", priority: 0 }];
		const allow = { authorize: async () => true };
		const definition = createDefaultRuntimeCapabilityDefinition({
			instructions,
			toolPolicy: allow,
			tokenBudget: 12_000,
			reservedOutputTokens: 2_000,
		});
		instructions.push({ id: "later", content: "must not leak", priority: 1 });

		expect(definition.instructions.map(({ id }) => id)).toEqual(["base"]);
		expect(definition.toolPolicy).toBe(allow);
		expect(definition.tokenBudget).toBe(12_000);
		expect(Object.isFrozen(definition)).toBe(true);
		expect(Object.isFrozen(definition.instructions)).toBe(true);
	});

	it.each([
		[{ tokenBudget: 0 }, "tokenBudget"],
		[{ reservedOutputTokens: -1 }, "reservedOutputTokens"],
		[{ tokenBudget: 4_000, reservedOutputTokens: 4_000 }, "smaller"],
	] as const)("rejects invalid budgets %#", (overrides, expected) => {
		expect(() => createDefaultRuntimeCapabilityDefinition(overrides)).toThrow(expected);
	});
});
