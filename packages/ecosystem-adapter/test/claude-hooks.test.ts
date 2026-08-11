import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHookAdapter } from "../src/claude-code/hooks/adapter.js";
import { discoverClaudeHookHandlers, discoverClaudeHookHandlersFromDocument } from "../src/claude-code/hooks/config.js";
import { expandClaudePlaceholders } from "../src/claude-code/hooks/placeholders.js";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "../src/claude-code/hooks/profile.js";
import { mapToolToClaude } from "../src/claude-code/hooks/tool-mapper.js";
import { createEcosystemHookRuntime } from "../src/runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
	// Best-effort cleanup; Windows may lock briefly.
	for (const dir of tempDirs.splice(0)) {
		try {
			const { rm } = await import("node:fs/promises");
			await rm(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "vetta-claude-hooks-"));
	tempDirs.push(dir);
	return dir;
}

describe("claude path placeholders", () => {
	it("expands CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR including paths with spaces", () => {
		const command = [
			'"',
			"$",
			"{CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh",
			'" && echo ',
			"$",
			"{CLAUDE_PROJECT_DIR}",
		].join("");
		const expanded = expandClaudePlaceholders(command, {
			pluginRoot: "C:\\Plugins\\My Plugin",
			projectDir: "D:\\Work\\demo project",
		});
		expect(expanded).toContain("C:\\Plugins\\My Plugin/scripts/preflight.sh");
		expect(expanded).toContain("D:\\Work\\demo project");
	});
});

describe("claude tool mapper", () => {
	it("maps host tools to Claude canonical names", () => {
		expect(mapToolToClaude({ hostName: "bash", kind: "shell" }).name).toBe("Bash");
		expect(mapToolToClaude({ hostName: "write", kind: "file-edit" }).name).toBe("Write");
		expect(mapToolToClaude({ hostName: "edit", kind: "file-edit" }).name).toBe("Edit");
		expect(mapToolToClaude({ hostName: "spawn_agent", kind: "agent" }).name).toBe("Agent");
		expect(mapToolToClaude({ hostName: "TeamCreate", kind: "custom" }).name).toBe("TeamCreate");
	});
});

describe("discoverClaudeHookHandlers", () => {
	it("skips dynamic Skill handlers whose if filter cannot be evaluated", () => {
		const result = discoverClaudeHookHandlersFromDocument(
			{
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "echo unsafe", if: "Bash(git push:*)" }],
					},
				],
			},
			{ path: "C:/skills/review/SKILL.md" },
		);

		expect(result.handlers).toHaveLength(0);
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported_handler_mode" }));
	});

	it("loads SessionStart command handlers from .claude/settings.json", async () => {
		const root = await makeTempDir();
		const claudeDir = join(root, ".claude");
		await mkdir(claudeDir, { recursive: true });
		await writeFile(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command: `node -e ${JSON.stringify(`process.stdout.write("preflight")`)}`,
								},
							],
						},
					],
				},
			}),
			"utf8",
		);

		const result = await discoverClaudeHookHandlers([{ directory: claudeDir, enabled: true }], {
			projectDir: root,
		});
		expect(result.diagnostics).toEqual([]);
		expect(result.handlers).toHaveLength(1);
		expect(result.handlers[0]?.eventName).toBe("SessionStart");
		expect(result.handlers[0]?.command).toContain("node -e");
	});

	it("loads original cc-skills council hooks.json with CLAUDE_PLUGIN_ROOT expansion", async () => {
		const pluginRoot = await makeTempDir();
		const hooksDir = join(pluginRoot, "hooks");
		const scriptsDir = join(pluginRoot, "scripts");
		await mkdir(hooksDir, { recursive: true });
		await mkdir(scriptsDir, { recursive: true });
		await writeFile(
			join(scriptsDir, "preflight.sh"),
			"#!/bin/bash\necho 'Council plugin: missing CLIs: codex (fixture)'\n",
			"utf8",
		);
		await writeFile(
			join(hooksDir, "hooks.json"),
			JSON.stringify({
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command: ["$", "{CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh"].join(""),
								},
							],
						},
					],
				},
			}),
			"utf8",
		);

		const result = await discoverClaudeHookHandlers(
			[
				{
					directory: pluginRoot,
					enabled: true,
					sources: [
						{
							path: join(hooksDir, "hooks.json"),
							env: { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: pluginRoot },
							pluginId: "council",
							profileId: CLAUDE_CODE_HOOK_PROFILE_ID,
						},
					],
				},
			],
			{ projectDir: pluginRoot },
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.handlers).toHaveLength(1);
		expect(result.handlers[0]?.command.replace(/\\/g, "/")).toContain(
			`${pluginRoot.replace(/\\/g, "/")}/scripts/preflight.sh`,
		);
		expect(result.handlers[0]?.env?.CLAUDE_PLUGIN_ROOT).toBe(pluginRoot);
	});

	it("reports unsupported handler types and events", async () => {
		const root = await makeTempDir();
		const claudeDir = join(root, ".claude");
		await mkdir(claudeDir, { recursive: true });
		await writeFile(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				hooks: {
					Notification: [{ hooks: [{ type: "command", command: "echo hi" }] }],
					SessionStart: [
						{
							hooks: [
								{ type: "http", url: "http://example.com" },
								{ type: "prompt", prompt: "yes?" },
							],
						},
					],
				},
			}),
			"utf8",
		);
		const result = await discoverClaudeHookHandlers([{ directory: claudeDir, enabled: true }], {
			projectDir: root,
		});
		expect(result.handlers).toHaveLength(0);
		expect(result.diagnostics.some((d) => d.code === "unsupported_event")).toBe(true);
		expect(result.diagnostics.filter((d) => d.code === "unsupported_handler_type")).toHaveLength(2);
	});
});

async function writeHookProject(files: Record<string, string>): Promise<{ root: string; claudeDir: string }> {
	const root = await makeTempDir();
	const claudeDir = join(root, ".claude");
	await mkdir(claudeDir, { recursive: true });
	for (const [relative, content] of Object.entries(files)) {
		const absolute = join(root, relative);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, content, "utf8");
	}
	return { root, claudeDir };
}

describe("createClaudeHookAdapter runtime", () => {
	it("registers turn-scoped Skill frontmatter hooks without static Claude config", async () => {
		const root = await makeTempDir();
		await writeFile(
			join(root, "skill-hook.cjs"),
			`process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "skill hook ran" } }));\n`,
			"utf8",
		);
		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "skill-hook-session",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [],
		});
		await runtime.runPendingSessionStart();
		await runtime.runUserPromptSubmit("use the review skill");

		expect(
			await runtime.registerCurrentTurnContribution({
				id: "skill:C:/skills/review/SKILL.md",
				revision: "v1",
				profileId: CLAUDE_CODE_HOOK_PROFILE_ID,
				sourcePath: join(root, "SKILL.md"),
				configuration: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "node skill-hook.cjs", once: true }],
						},
					],
				},
			}),
		).toBe(true);

		const first = await runtime.runPreToolUse("call-1", { hostName: "bash", kind: "shell" }, {});
		expect(first.additionalContexts).toContain("skill hook ran");
		expect((await runtime.runPreToolUse("call-2", { hostName: "bash", kind: "shell" }, {})).runs).toHaveLength(0);

		runtime.finishCurrentTurn();
		await runtime.runUserPromptSubmit("use it again");
		await runtime.registerCurrentTurnContribution({
			id: "skill:C:/skills/review/SKILL.md",
			revision: "v1",
			profileId: CLAUDE_CODE_HOOK_PROFILE_ID,
			sourcePath: join(root, "SKILL.md"),
			configuration: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "node skill-hook.cjs", once: true }],
					},
				],
			},
		});
		expect((await runtime.runPreToolUse("call-3", { hostName: "bash", kind: "shell" }, {})).runs).toHaveLength(0);

		await runtime.registerCurrentTurnContribution({
			id: "skill:C:/skills/review/SKILL.md",
			revision: "v2",
			profileId: CLAUDE_CODE_HOOK_PROFILE_ID,
			sourcePath: join(root, "SKILL.md"),
			configuration: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "node skill-hook.cjs" }],
					},
				],
			},
		});
		expect((await runtime.runPreToolUse("call-4", { hostName: "bash", kind: "shell" }, {})).runs).toHaveLength(1);

		runtime.finishCurrentTurn();
		await runtime.runUserPromptSubmit("start the next turn");
		expect((await runtime.runPreToolUse("call-5", { hostName: "bash", kind: "shell" }, {})).runs).toHaveLength(0);
	});

	it("SessionStart plain stdout becomes additional context", async () => {
		const { root, claudeDir } = await writeHookProject({
			"session-start.cjs": `process.stdout.write("preflight context from fixture");\n`,
			".claude/settings.json": JSON.stringify({
				hooks: {
					SessionStart: [{ hooks: [{ type: "command", command: "node session-start.cjs" }] }],
				},
			}),
		});

		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "session-1",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [{ directory: claudeDir, enabled: true, label: "fixture" }],
		});

		const outcome = await runtime.runPendingSessionStart();
		expect(outcome?.shouldBlock).toBe(false);
		expect(outcome?.shouldStop).toBe(false);
		expect(outcome?.additionalContexts.some((c) => c.includes("preflight context"))).toBe(true);
		expect(outcome?.runs.some((run) => run.profileId === CLAUDE_CODE_HOOK_PROFILE_ID)).toBe(true);
	});

	it("UserPromptSubmit decision:block stops the prompt", async () => {
		const { root, claudeDir } = await writeHookProject({
			"block-prompt.cjs": `
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const prompt = JSON.parse(data).prompt || "";
  if (/^\\s*\\/cdt(\\s|:|$)/.test(prompt)) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "CDT requires Agent Teams (fixture)"
    }));
  }
});
`,
			".claude/settings.json": JSON.stringify({
				hooks: {
					UserPromptSubmit: [{ hooks: [{ type: "command", command: "node block-prompt.cjs" }] }],
				},
			}),
		});

		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "session-2",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [{ directory: claudeDir, enabled: true }],
		});
		await runtime.runPendingSessionStart();
		const blocked = await runtime.runUserPromptSubmit("/cdt plan something");
		expect(blocked.shouldStop || blocked.shouldBlock).toBe(true);
		expect(blocked.stopReason ?? blocked.blockReason).toContain("Agent Teams");

		const allowed = await runtime.runUserPromptSubmit("hello without slash command");
		expect(allowed.shouldStop).toBe(false);
		expect(allowed.shouldBlock).toBe(false);
	});

	it("PreToolUse permissionDecision:deny blocks tool", async () => {
		const { root, claudeDir } = await writeHookProject({
			"deny-write.cjs": `
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const body = JSON.parse(data);
  if (body.tool_name === "Write") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Write blocked by fixture hook"
      }
    }));
  }
});
`,
			".claude/settings.json": JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Write|Edit",
							hooks: [{ type: "command", command: "node deny-write.cjs" }],
						},
					],
				},
			}),
		});

		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "session-3",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [{ directory: claudeDir, enabled: true }],
		});
		await runtime.runPendingSessionStart();
		await runtime.runUserPromptSubmit("touch files");
		const denied = await runtime.runPreToolUse(
			"call-1",
			{ hostName: "write", kind: "file-edit" },
			{
				path: "a.txt",
				content: "x",
			},
		);
		expect(denied.shouldBlock).toBe(true);
		expect(denied.blockReason).toContain("Write blocked");

		const bashOk = await runtime.runPreToolUse(
			"call-2",
			{ hostName: "bash", kind: "shell" },
			{
				command: "echo hi",
			},
		);
		expect(bashOk.shouldBlock).toBe(false);
	});

	it("Stop decision:block produces continuation fragments and stop_hook_active on reentry", async () => {
		const { root, claudeDir } = await writeHookProject({
			"stop-gate.cjs": `
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const body = JSON.parse(data);
  if (!body.stop_hook_active) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "check unfinished tasks (fixture)"
    }));
  }
});
`,
			".claude/settings.json": JSON.stringify({
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: "node stop-gate.cjs" }] }],
				},
			}),
		});

		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "session-4",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [{ directory: claudeDir, enabled: true }],
		});
		await runtime.runPendingSessionStart();
		await runtime.runUserPromptSubmit("do work");
		const fragments = await runtime.runStop("assistant done");
		expect(fragments.some((f) => f.includes("unfinished tasks"))).toBe(true);

		const second = await runtime.runStop("assistant after continuation");
		expect(second).toEqual([]);
	});

	it("SessionEnd maps Vetta cause to Claude reason for matcher and stdin", async () => {
		const { root, claudeDir } = await writeHookProject({
			"session-end.cjs": `
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const body = JSON.parse(data);
  if (body.hook_event_name !== "SessionEnd") process.exit(1);
  // Wire still uses Claude reason (new_session / fork_session → clear)
  if (body.reason !== "clear") process.exit(1);
  process.stdout.write(JSON.stringify({
    systemMessage: "session end ok"
  }));
});
`,
			".claude/settings.json": JSON.stringify({
				hooks: {
					SessionEnd: [
						{
							// Claude settings matcher stays on Claude reason vocabulary
							matcher: "clear",
							hooks: [{ type: "command", command: "node session-end.cjs" }],
						},
					],
				},
			}),
		});

		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "session-end-1",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [{ directory: claudeDir, enabled: true }],
		});
		await runtime.runPendingSessionStart();

		const newSessionEnd = await runtime.runSessionEnd("new_session");
		expect(newSessionEnd.shouldBlock).toBe(false);
		expect(newSessionEnd.shouldStop).toBe(false);
		expect(newSessionEnd.runs).toHaveLength(1);
		expect(newSessionEnd.runs[0]?.status).toBe("Completed");

		const forkEnd = await runtime.runSessionEnd("fork_session");
		expect(forkEnd.runs).toHaveLength(1);
		expect(forkEnd.runs[0]?.status).toBe("Completed");

		// switch_session → Claude reason "resume"; does not match matcher "clear"
		const switchEnd = await runtime.runSessionEnd("switch_session");
		expect(switchEnd.runs).toHaveLength(0);

		// dispose → Claude reason "other"
		const disposeEnd = await runtime.runSessionEnd("dispose");
		expect(disposeEnd.runs).toHaveLength(0);
	});

	it("PostToolUseFailure returns additionalContext and exit 2 feedback", async () => {
		const { root, claudeDir } = await writeHookProject({
			"failure-context.cjs": `
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const body = JSON.parse(data);
  if (body.hook_event_name !== "PostToolUseFailure") process.exit(1);
  if (!body.error || body.tool_name !== "Bash") process.exit(1);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: "retry with smaller batch"
    }
  }));
});
`,
			"failure-feedback.cjs": `
process.stderr.write("tool failed; check credentials");
process.exit(2);
`,
			".claude/settings.json": JSON.stringify({
				hooks: {
					PostToolUseFailure: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "node failure-context.cjs" }],
						},
						{
							matcher: "Write",
							hooks: [{ type: "command", command: "node failure-feedback.cjs" }],
						},
					],
				},
			}),
		});

		const runtime = createEcosystemHookRuntime({
			host: {
				cwd: root,
				getSessionId: () => "session-fail-1",
				getTranscriptPath: () => null,
				getModelId: () => "test-model",
				abortCurrentRun: () => {},
			},
			initialSessionStartSource: "startup",
			configLayers: [{ directory: claudeDir, enabled: true }],
		});
		await runtime.runPendingSessionStart();
		await runtime.runUserPromptSubmit("run tools");

		const bashFail = await runtime.runPostToolUseFailure(
			"call-fail-1",
			{ hostName: "bash", kind: "shell" },
			{ command: "false" },
			"Command exited with non-zero status code 1",
			{ durationMs: 12 },
		);
		expect(bashFail.shouldBlock).toBe(false);
		expect(bashFail.additionalContexts.some((c) => c.includes("smaller batch"))).toBe(true);

		const writeFail = await runtime.runPostToolUseFailure(
			"call-fail-2",
			{ hostName: "write", kind: "file-edit" },
			{ path: "a.txt", content: "x" },
			"write failed",
		);
		expect(writeFail.shouldBlock).toBe(false);
		expect(writeFail.feedbackMessage).toContain("credentials");
	});
});

describe("createClaudeHookAdapter presence", () => {
	it("keeps a mutable adapter available when no Claude sources exist", async () => {
		const root = await makeTempDir();
		const adapter = await createClaudeHookAdapter({
			configLayers: [{ directory: join(root, "missing"), enabled: true }],
			projectDir: root,
		});
		expect(adapter).toBeDefined();
	});
});
