import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodingAgentPromptRuntime } from "../src/model-context/prompt-runtime.js";
import type { CodingAgentModelCallPromptContext } from "../src/runtime-contracts/index.js";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-prompt-runtime-"));
	createdDirs.push(root);
	mkdirSync(join(root, ".git"));
	return root;
}

function createRuntime(cwd: string, workspaceFacts?: string): CodingAgentPromptRuntime {
	return new CodingAgentPromptRuntime({
		cwd,
		...(workspaceFacts !== undefined ? { workspaceFacts } : {}),
		scenario: "cli",
		resourceLoader: {
			refreshContextResourcesIfChanged: () => false,
			refreshSkillsIfChanged: () => false,
			setRuntimeSkillPaths: () => {},
			getSystemPrompt: () => "",
			getAppendSystemPrompt: () => [],
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
		},
		settingsManager: {
			reloadPersonalizationSettings: () => {},
			getPersonalization: () => ({ personaId: "default", customPrompt: "" }),
		},
	});
}

const promptContext: CodingAgentModelCallPromptContext = {
	sessionId: "session-1",
	turnId: "turn-1",
	signal: new AbortController().signal,
	activeToolNames: ["read"],
	messages: [],
	frame: { instructions: [], tools: new Map() },
};

describe("CodingAgentPromptRuntime workspace facts", () => {
	it("probes the working directory once at session construction", () => {
		const runtime = createRuntime(createWorkspace());

		expect(runtime.resolve(promptContext).workspaceFacts).toContain("It is a Git repository.");
	});

	it("keeps the probed facts fixed for the whole session, including per-Turn bindings", () => {
		const cwd = createWorkspace();
		const runtime = createRuntime(cwd);
		const boundResolve = runtime.bindForTurn();

		// 会话开始后工作区变成 Node 工程：已固化的事实不得随之改变，否则前缀缓存每轮抖动。
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "late-arrival" }), "utf-8");

		expect(boundResolve(promptContext).workspaceFacts).not.toContain("late-arrival");
		expect(runtime.resolve(promptContext).workspaceFacts).not.toContain("late-arrival");
	});

	it("uses injected facts verbatim instead of probing", () => {
		const runtime = createRuntime(createWorkspace(), "# Workspace\n\n- Injected.");

		expect(runtime.resolve(promptContext).workspaceFacts).toBe("# Workspace\n\n- Injected.");
	});

	it("leaves the facts undefined for a directory with no detectable signal", () => {
		const root = mkdtempSync(join(tmpdir(), "vetta-prompt-runtime-empty-"));
		createdDirs.push(root);

		expect(createRuntime(root).resolve(promptContext).workspaceFacts).toBeUndefined();
	});
});
