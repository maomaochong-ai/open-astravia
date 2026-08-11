import { describe, expect, it } from "vitest";
import { createCodingToolsRuntimeComposition } from "../src/composition/tool-surface/runtime-tools-composition.js";
import { ALL_SCENARIOS } from "../src/profiles/index.js";

const DEFAULT_TOOL_NAMES = {
	win32: ["current_time", "dir_tree", "edit", "glob", "grep", "read", "shell", "task_output", "task_stop", "write"],
	posix: ["bash", "current_time", "dir_tree", "edit", "glob", "grep", "read", "task_output", "task_stop", "write"],
} as const;

function modelCallContext(signal = new AbortController().signal) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		signal,
	};
}

describe("Coding Tools Runtime Composition Root", () => {
	it("registers and compiles the default CLI coding tools without downloading", async () => {
		const calls: Array<{ readonly tool: "fd" | "rg"; readonly silent: boolean | undefined }> = [];
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			ensureTool: async (tool, silent) => {
				calls.push({ tool, silent });
				return undefined;
			},
		});

		const compiled = await composition.compile();
		try {
			const provider = compiled.snapshot.modelCallProviders?.[0];
			if (!provider) throw new Error("expected coding tools model call provider");
			const contribution = await provider.contribute(modelCallContext());
			expect(contribution.tools?.map(({ name }) => name)).toEqual(
				process.platform === "win32" ? DEFAULT_TOOL_NAMES.win32 : DEFAULT_TOOL_NAMES.posix,
			);
			await expect(composition.executableResolver.resolve("rg")).resolves.toBeUndefined();
			expect(calls).toEqual([{ tool: "rg", silent: true }]);
		} finally {
			await compiled.dispose();
			composition.dispose();
		}
	});

	it("keeps fail-closed tools available for explicit activation", async () => {
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			activation: {
				mode: "explicit",
				toolNames: ["find", "ls"],
			},
			ensureTool: async () => undefined,
		});

		const compiled = await composition.compile();
		try {
			const provider = compiled.snapshot.modelCallProviders?.[0];
			if (!provider) throw new Error("expected coding tools model call provider");
			const contribution = await provider.contribute(modelCallContext());
			expect(contribution.tools?.map(({ name }) => name)).toEqual(["find", "ls"]);
		} finally {
			await compiled.dispose();
			composition.dispose();
		}
	});

	it.each(ALL_SCENARIOS)("matches the frozen active tool contract for %s", async (scenario) => {
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			activation: { mode: "scope", scope: scenario, capabilities: new Set(["bg-tasks"]) },
			ensureTool: async () => undefined,
		});

		const compiled = await composition.compile();
		try {
			const provider = compiled.snapshot.modelCallProviders?.[0];
			if (!provider) throw new Error("expected coding tools model call provider");
			const contribution = await provider.contribute(modelCallContext());
			const runtimeToolNames = contribution.tools?.map(({ name }) => name).sort();
			const expected = process.platform === "win32" ? DEFAULT_TOOL_NAMES.win32 : DEFAULT_TOOL_NAMES.posix;
			expect(runtimeToolNames).toEqual([...expected].sort());
		} finally {
			await compiled.dispose();
			composition.dispose();
		}
	});
});
