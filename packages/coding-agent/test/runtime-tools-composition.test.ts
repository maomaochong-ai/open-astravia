import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createCodingToolsRuntimeComposition } from "../src/composition/tool-surface/runtime-tools-composition.js";
import { createCodingAgentNodeToolEnvironment } from "../src/host/tool-environment/node/node-tool-environment.js";
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
	it("preserves complete tool results when the Host does not select an artifact policy", async () => {
		const completeResult = { content: [{ type: "text" as const, text: "x".repeat(60 * 1024) }] };
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: {
				registrations: [
					registration({
						...tool("read"),
						execute: async () => completeResult,
					}),
				],
				dispose() {},
			},
		});
		const entry = composition.registry.resolve("read");
		if (!entry) throw new Error("expected read registration");

		const result = await composition.registry.execute(entry.binding, {
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: {},
			signal: new AbortController().signal,
		});

		expect(result).toBe(completeResult);
		composition.dispose();
	});

	it("owns platform environment disposal while preserving Coding Agent model order", async () => {
		const dispose = vi.fn();
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: {
				registrations: [registration(tool("write")), registration(tool("read"))],
				dispose,
			},
			activation: { mode: "explicit", toolNames: ["write", "read"] },
		});

		const compiled = await composition.compile();
		try {
			const provider = compiled.snapshot.modelCallProviders?.[0];
			if (!provider) throw new Error("expected coding tools model call provider");
			const contribution = await provider.contribute(modelCallContext());
			expect(contribution.tools?.map(({ name }) => name)).toEqual(["read", "write"]);
		} finally {
			await compiled.dispose();
			composition.dispose();
		}
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("replaces legacy Host definitions for Coding Agent-owned base Tools", () => {
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: {
				registrations: [
					registration({ ...tool("current_time"), label: "legacy-host-time" }),
					registration(tool("task_output")),
				],
				dispose() {},
			},
		});

		expect(composition.registry.resolve("current_time")?.registration.tool.label).toBe("Current Time");
		expect(composition.registry.resolve("task_output")).toBeUndefined();
		composition.dispose();
	});

	it("updates activation declarations with dynamically registered tools", () => {
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: { registrations: [], dispose() {} },
		});

		composition.registerTool({
			...registration(tool("host_attachment")),
			category: "external",
		});
		expect(composition.readToolDeclaration("host_attachment")?.category).toBe("external");
		expect(composition.registry.resolve("host_attachment")).toBeDefined();

		expect(composition.unregisterTool("host_attachment")).toBe(true);
		expect(composition.readToolDeclaration("host_attachment")).toBeUndefined();
		expect(composition.registry.resolve("host_attachment")).toBeUndefined();
		composition.dispose();
	});

	it("uses an explicit result projection declaration instead of tool category", async () => {
		const project = vi.fn(async () => ({ content: [{ type: "text" as const, text: "projected" }] }));
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: { registrations: [], dispose() {} },
			additionalRegistrations: [
				{
					...registration(tool("external_result")),
					category: "core",
					resultProjection: "preserve",
				},
			],
			resultPolicy: { project },
		});
		const entry = composition.registry.resolve("external_result");
		if (!entry) throw new Error("expected explicit result projection registration");

		const result = await composition.registry.execute(entry.binding, {
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: {},
			signal: new AbortController().signal,
		});

		expect(result.content).toEqual([{ type: "text", text: "external_result" }]);
		expect(project).not.toHaveBeenCalled();
		composition.dispose();
	});

	it("registers and compiles the default CLI coding tools without downloading", async () => {
		const calls: Array<{ readonly tool: "fd" | "rg"; readonly silent: boolean | undefined }> = [];
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: createCodingAgentNodeToolEnvironment(
				{ cwd: "C:/workspace", scenario: "cli" },
				{
					ensureTool: async (tool, silent) => {
						calls.push({ tool, silent });
						return undefined;
					},
				},
			),
		});

		const compiled = await composition.compile();
		try {
			const provider = compiled.snapshot.modelCallProviders?.[0];
			if (!provider) throw new Error("expected coding tools model call provider");
			const contribution = await provider.contribute(modelCallContext());
			expect(contribution.tools?.map(({ name }) => name)).toEqual(
				process.platform === "win32" ? DEFAULT_TOOL_NAMES.win32 : DEFAULT_TOOL_NAMES.posix,
			);
			expect(calls).toEqual([]);
		} finally {
			await compiled.dispose();
			composition.dispose();
		}
	});

	it("keeps fail-closed tools available for explicit activation", async () => {
		const composition = createCodingToolsRuntimeComposition({
			cwd: "C:/workspace",
			environment: createCodingAgentNodeToolEnvironment({ cwd: "C:/workspace", scenario: "cli" }),
			activation: {
				mode: "explicit",
				toolNames: ["find", "ls"],
			},
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
			environment: createCodingAgentNodeToolEnvironment({ cwd: "C:/workspace", scenario }),
			activation: { mode: "scope", scope: scenario, capabilities: new Set(["bg-tasks"]) },
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

function tool(name: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

function registration(toolDefinition: RuntimeToolDefinition) {
	return {
		tool: toolDefinition,
		scopeUse: ["cli" as const],
		category: "core" as const,
	};
}
