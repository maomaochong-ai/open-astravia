import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverClaudeHookHandlers, isClaudeOwnedSource } from "../src/claude-code/hooks/config.js";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "../src/claude-code/hooks/profile.js";
import { discoverCodexHookHandlers, isCodexOwnedSource } from "../src/codex/hooks/config.js";
import { LATEST_CODEX_HOOK_PROFILE_ID } from "../src/codex/hooks/latest/profile.js";
import { buildDefaultHookConfigLayers } from "../src/default-hook-config-layers.js";

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		try {
			const { rm } = await import("node:fs/promises");
			await rm(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function sessionStartHooks(command: string): string {
	return JSON.stringify({
		hooks: {
			SessionStart: [
				{
					hooks: [{ type: "command", command }],
				},
			],
		},
	});
}

/** Claude settings.json may carry other keys; hooks stay under "hooks". */
function claudeSettingsWithHooks(command: string): string {
	return JSON.stringify({
		permissions: { allow: ["Bash(*)"] },
		hooks: {
			SessionStart: [
				{
					hooks: [{ type: "command", command }],
				},
			],
		},
	});
}

describe("buildDefaultHookConfigLayers", () => {
	it("includes only Astravia-nested .codex/.claude paths with profile ownership", () => {
		const home = "C:/fake-home";
		const cwd = "C:/projects/demo";
		const layers = buildDefaultHookConfigLayers({
			cwd,
			homeDir: home,
			env: {},
		});

		const paths = layers.flatMap((layer) => (layer.sources ?? []).map((s) => s.path.replace(/\\/g, "/")));
		expect(paths).toEqual([
			"C:/fake-home/.astravia/.codex/hooks.json",
			"C:/fake-home/.astravia/.claude/settings.json",
			"C:/projects/demo/.astravia/.codex/hooks.json",
			"C:/projects/demo/.astravia/.claude/settings.json",
			"C:/projects/demo/.astravia/.claude/settings.local.json",
		]);

		const byProfile = layers.flatMap((layer) =>
			(layer.sources ?? []).map((s) => ({ path: s.path.replace(/\\/g, "/"), profileId: s.profileId })),
		);
		expect(
			byProfile
				.filter((s) => s.path.includes("/.codex/"))
				.every((s) => s.profileId === LATEST_CODEX_HOOK_PROFILE_ID),
		).toBe(true);
		expect(
			byProfile
				.filter((s) => s.path.includes("/.claude/"))
				.every((s) => s.profileId === CLAUDE_CODE_HOOK_PROFILE_ID),
		).toBe(true);

		// Never top-level official homes
		expect(paths.some((p) => p.includes("/fake-home/.codex/") && !p.includes("/.astravia/"))).toBe(false);
		expect(paths.some((p) => p.includes("/fake-home/.claude/") && !p.includes("/.astravia/"))).toBe(false);
		expect(paths.some((p) => p.includes("/demo/.codex/") && !p.includes("/.astravia/"))).toBe(false);
		expect(paths.some((p) => p.includes("/demo/.claude/") && !p.includes("/.astravia/"))).toBe(false);
	});

	it("honors explicit astraviaHome", () => {
		const layers = buildDefaultHookConfigLayers({
			cwd: "/p",
			astraviaHome: "/custom/astravia",
			env: {},
		});
		const paths = layers.flatMap((l) => (l.sources ?? []).map((s) => s.path.replace(/\\/g, "/")));
		expect(paths).toContain("/custom/astravia/.codex/hooks.json");
		expect(paths).toContain("/custom/astravia/.claude/settings.json");
		expect(paths).not.toContain("/home/u/.astravia/.codex/hooks.json");
	});
});

describe("source ownership filters", () => {
	it("classifies .codex/.claude paths with or without .astravia nesting", () => {
		expect(isCodexOwnedSource({ path: "/home/u/.astravia/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/repo/.astravia/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/home/u/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/repo/.codex/hooks.json" })).toBe(true);
		expect(isCodexOwnedSource({ path: "/repo/.astravia/hooks.json" })).toBe(false);
		expect(isCodexOwnedSource({ path: "/home/u/.astravia/.claude/settings.json" })).toBe(false);
		expect(isCodexOwnedSource({ path: "/plugin/hooks/hooks.json" })).toBe(false);

		expect(isClaudeOwnedSource({ path: "/home/u/.astravia/.claude/settings.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/repo/.astravia/.claude/settings.local.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/home/u/.claude/settings.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/repo/.claude/settings.local.json" })).toBe(true);
		expect(isClaudeOwnedSource({ path: "/repo/.astravia/claude-hooks.json" })).toBe(false);
		expect(isClaudeOwnedSource({ path: "/home/u/.astravia/.codex/hooks.json" })).toBe(false);
	});
});

describe("astravia-nested path discovery", () => {
	it("loads Codex handlers from .astravia/.codex and ignores top-level official + Claude", async () => {
		const home = await makeTempDir("astravia-codex-home-");
		const project = await makeTempDir("astravia-codex-proj-");
		const astraviaHome = join(home, ".astravia");

		await mkdir(join(astraviaHome, ".codex"), { recursive: true });
		await mkdir(join(project, ".astravia", ".codex"), { recursive: true });
		// Top-level official + Claude must be ignored by default layers
		await mkdir(join(home, ".codex"), { recursive: true });
		await mkdir(join(project, ".codex"), { recursive: true });
		await mkdir(join(project, ".astravia", ".claude"), { recursive: true });

		await writeFile(join(astraviaHome, ".codex", "hooks.json"), sessionStartHooks("echo codex-user"), "utf8");
		await writeFile(
			join(project, ".astravia", ".codex", "hooks.json"),
			sessionStartHooks("echo codex-project"),
			"utf8",
		);
		await writeFile(join(home, ".codex", "hooks.json"), sessionStartHooks("echo official-user"), "utf8");
		await writeFile(join(project, ".codex", "hooks.json"), sessionStartHooks("echo official-project"), "utf8");
		await writeFile(
			join(project, ".astravia", ".claude", "settings.json"),
			claudeSettingsWithHooks("echo claude-only"),
			"utf8",
		);

		const layers = buildDefaultHookConfigLayers({
			cwd: project,
			homeDir: home,
			env: {},
		});
		const result = await discoverCodexHookHandlers(layers);
		expect(result.diagnostics).toEqual([]);
		expect(result.handlers.map((h) => h.command)).toEqual(["echo codex-user", "echo codex-project"]);
	});

	it("loads Claude handlers from .astravia/.claude settings including extra keys", async () => {
		const home = await makeTempDir("astravia-claude-home-");
		const project = await makeTempDir("astravia-claude-proj-");
		const astraviaHome = join(home, ".astravia");

		await mkdir(join(astraviaHome, ".claude"), { recursive: true });
		await mkdir(join(project, ".astravia", ".claude"), { recursive: true });
		await mkdir(join(home, ".claude"), { recursive: true });
		await mkdir(join(project, ".claude"), { recursive: true });
		await mkdir(join(project, ".astravia", ".codex"), { recursive: true });

		await writeFile(
			join(astraviaHome, ".claude", "settings.json"),
			claudeSettingsWithHooks("echo claude-user"),
			"utf8",
		);
		await writeFile(
			join(project, ".astravia", ".claude", "settings.json"),
			claudeSettingsWithHooks("echo claude-project"),
			"utf8",
		);
		await writeFile(
			join(project, ".astravia", ".claude", "settings.local.json"),
			claudeSettingsWithHooks("echo claude-local"),
			"utf8",
		);
		await writeFile(join(home, ".claude", "settings.json"), claudeSettingsWithHooks("echo official-user"), "utf8");
		await writeFile(
			join(project, ".claude", "settings.json"),
			claudeSettingsWithHooks("echo official-project"),
			"utf8",
		);
		await writeFile(join(project, ".astravia", ".codex", "hooks.json"), sessionStartHooks("echo codex-only"), "utf8");

		const layers = buildDefaultHookConfigLayers({
			cwd: project,
			homeDir: home,
			env: {},
		});
		const result = await discoverClaudeHookHandlers(layers, { projectDir: project });
		expect(result.diagnostics).toEqual([]);
		expect(result.handlers.map((h) => h.command)).toEqual([
			"echo claude-user",
			"echo claude-project",
			"echo claude-local",
		]);
	});
});
