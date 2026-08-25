import { describe, expect, it } from "vitest";
import { compilePromptCacheLayout, type InstructionBlock, sanitizePromptCacheLayout } from "../../src/kernel/index.js";

describe("prompt cache layout", () => {
	it("treats compiled instructions as one stable prefix by default", () => {
		expect(
			compilePromptCacheLayout(
				[instruction("base", "base", 0), instruction("feature", "feature", 10)],
				() => "stable",
			),
		).toEqual({
			systemPromptStableLength: "base\n\nfeature".length,
			promptCacheSystemPromptBlocks: [
				{ id: "base", start: 0, length: 4, cacheability: "stable" },
				{ id: "feature", start: 6, length: 7, cacheability: "stable" },
			],
		});
	});

	it("keeps a call-scoped tail outside the stable prefix", () => {
		expect(
			compilePromptCacheLayout([instruction("base", "base", 0), instruction("dynamic", "dynamic", 10)], ({ id }) =>
				id === "dynamic" ? "volatile" : "stable",
			),
		).toEqual({
			systemPromptStableLength: 4,
			promptCacheSystemPromptBlocks: [
				{ id: "base", start: 0, length: 4, cacheability: "stable" },
				{ id: "dynamic", start: 6, length: 7, cacheability: "volatile" },
			],
		});
	});

	it("never crosses an early volatile block and honors explicit overrides", () => {
		const layout = compilePromptCacheLayout(
			[
				{ ...instruction("dynamic", "dynamic", 0), cacheability: "volatile" },
				{ ...instruction("claimed-stable", "later", 10), cacheability: "stable" },
			],
			() => "stable",
		);

		expect(layout.systemPromptStableLength).toBe(0);
		expect(layout.promptCacheSystemPromptBlocks.map(({ cacheability }) => cacheability)).toEqual([
			"volatile",
			"volatile",
		]);
	});

	it("ignores empty blocks while keeping exact separator offsets", () => {
		expect(
			compilePromptCacheLayout(
				[instruction("empty", "", 0), instruction("base", "base", 10), instruction("tail", "tail", 20)],
				({ id }) => (id === "tail" ? "volatile" : "stable"),
			),
		).toEqual({
			systemPromptStableLength: 4,
			promptCacheSystemPromptBlocks: [
				{ id: "base", start: 0, length: 4, cacheability: "stable" },
				{ id: "tail", start: 6, length: 4, cacheability: "volatile" },
			],
		});
	});

	it("degrades malformed explicit metadata without rejecting the model call", () => {
		expect(sanitizePromptCacheLayout([instruction("base", "base", 0)], 99, undefined)).toEqual({
			systemPromptStableLength: 0,
			degraded: true,
			degradationReason: "invalid-stable-length",
		});
		expect(
			sanitizePromptCacheLayout([instruction("base", "base", 0)], 4, [
				{ id: "outside", start: 4, length: 1, cacheability: "stable" },
			]),
		).toEqual({
			systemPromptStableLength: 0,
			degraded: true,
			degradationReason: "invalid-block-layout",
		});
	});
});

function instruction(id: string, content: string, priority: number): InstructionBlock {
	return { id, content, priority };
}
