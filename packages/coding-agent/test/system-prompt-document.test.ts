import { describe, expect, it } from "vitest";
import {
	applySystemPromptOperations,
	compileSystemPromptDraft,
	coreBlock,
	renderSystemPromptDraft,
	type SystemPromptDraft,
} from "../src/model-context/index.js";
import { validatePluginRuntimeEffects } from "../src/plugins/runtime/runtime-effect-schema.js";

describe("system prompt document invariants", () => {
	it("rejects duplicate and reserved plugin block ids", () => {
		const draft = createDraft();

		expect(() =>
			applySystemPromptOperations(draft, "plugin-a", [
				{ type: "addBlock", block: pluginBlock("plugin.extra") },
				{ type: "addBlock", block: pluginBlock("plugin.extra") },
			]),
		).toThrow("Duplicate system prompt block id: plugin.extra");
		expect(() =>
			applySystemPromptOperations(draft, "plugin-a", [{ type: "addBlock", block: pluginBlock("core.injected") }]),
		).toThrow("Plugin cannot add reserved core system prompt block: core.injected");
	});

	it("rejects duplicate drafts before rendering", () => {
		const draft = createDraft();
		draft.blocks.push(coreBlock("core.base", "base", "Duplicate", 200));

		expect(() => renderSystemPromptDraft(draft)).toThrow("Duplicate system prompt block id: core.base");
	});

	it("does not allow plugin patches to rewrite block provenance", () => {
		expect(() =>
			validatePluginRuntimeEffects([
				{
					type: "updateBlock",
					blockId: "core.base",
					patch: { source: { kind: "plugin", pluginId: "spoofed" } },
				},
			]),
		).toThrow("Plugin system prompt provider returned invalid runtime effects");
	});

	it("rejects replacing a core block that is not part of the stable draft", () => {
		expect(() =>
			applySystemPromptOperations(createDraft(), "plugin-a", [
				{
					type: "replaceBlock",
					blockId: "core.missing",
					block: pluginBlock("ignored"),
				},
			]),
		).toThrow("Cannot replace missing core system prompt block: core.missing");
	});

	it("reports per-block size and explicit budget overflow without truncating content", () => {
		const draft = createDraft();
		draft.metadata.promptBudgetTokens = 1;
		draft.blocks.push(coreBlock("core.footer", "footer", "Footer", 200));

		const compiled = compileSystemPromptDraft(draft);

		expect(compiled.content).toBe("Base\n\nFooter");
		expect(compiled.diagnostics).toMatchObject({
			charCount: 12,
			estimatedTokens: 3,
			enabledBlockCount: 2,
			promptBudgetTokens: 1,
			overBudget: true,
		});
		expect(compiled.diagnostics.blocks.map(({ id, estimatedTokens }) => ({ id, estimatedTokens }))).toEqual([
			{ id: "core.base", estimatedTokens: 1 },
			{ id: "core.footer", estimatedTokens: 2 },
		]);
	});
});

function createDraft(): SystemPromptDraft {
	return {
		blocks: [coreBlock("core.base", "base", "Base", 100)],
		metadata: { cwd: "C:\\workspace", dateTime: "now" },
	};
}

function pluginBlock(id: string) {
	return {
		id,
		type: "plugin" as const,
		source: { kind: "plugin" as const },
		content: "Plugin content",
		priority: 200,
		enabled: true,
	};
}
