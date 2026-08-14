import { describe, expect, it } from "vitest";
import {
	applySystemPromptOperations,
	compileSystemPromptDraft,
	coreBlock,
	renderSystemPromptDraft,
	STABLE_SYSTEM_PROMPT_PRIORITY,
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

describe("system prompt cache breakpoint", () => {
	it("splits content exactly at the stable/volatile priority boundary", () => {
		const draft: SystemPromptDraft = {
			blocks: [
				coreBlock("core.base", "base", "Base", 150),
				coreBlock("core.skills", "skills", "Skills", STABLE_SYSTEM_PROMPT_PRIORITY - 1),
				coreBlock("core.mode", "mode", "Mode", 850),
				coreBlock("core.footer", "footer", "Footer", 1000),
			],
			metadata: { cwd: "C:\\workspace", dateTime: "now" },
		};

		const { content, stableLength } = compileSystemPromptDraft(draft);

		expect(content).toBe("Base\n\nSkills\n\nMode\n\nFooter");
		expect(content.slice(0, stableLength)).toBe("Base\n\nSkills");
		// 块间分隔符归属其后的块，两段拼回必须与原文逐字相等。
		expect(content.slice(stableLength)).toBe("\n\nMode\n\nFooter");
		expect(content.slice(0, stableLength) + content.slice(stableLength)).toBe(content);
	});

	it("ignores disabled and empty blocks when computing the split point", () => {
		const draft: SystemPromptDraft = {
			blocks: [
				coreBlock("core.base", "base", "Base", 150),
				coreBlock("core.memory", "memory", "", 600),
				{ ...coreBlock("core.skills", "skills", "Skills", 700), enabled: false },
				coreBlock("core.footer", "footer", "Footer", 1000),
			],
			metadata: { cwd: "C:\\workspace", dateTime: "now" },
		};

		const { content, stableLength } = compileSystemPromptDraft(draft);

		expect(content).toBe("Base\n\nFooter");
		expect(content.slice(0, stableLength)).toBe("Base");
	});

	it("reports the full length when every block is stable", () => {
		const draft: SystemPromptDraft = {
			blocks: [coreBlock("core.base", "base", "Base", 150), coreBlock("core.skills", "skills", "Skills", 700)],
			metadata: { cwd: "C:\\workspace", dateTime: "now" },
		};

		const { content, stableLength } = compileSystemPromptDraft(draft);

		expect(stableLength).toBe(content.length);
	});

	it("reports zero when every block is volatile", () => {
		const draft: SystemPromptDraft = {
			blocks: [coreBlock("core.mode", "mode", "Mode", 850), coreBlock("core.footer", "footer", "Footer", 1000)],
			metadata: { cwd: "C:\\workspace", dateTime: "now" },
		};

		expect(compileSystemPromptDraft(draft).stableLength).toBe(0);
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
