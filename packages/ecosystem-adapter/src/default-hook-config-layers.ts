import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "./claude-code/hooks/profile.js";
import { LATEST_CODEX_HOOK_PROFILE_ID } from "./codex/hooks/latest/profile.js";
import type { HookConfigLayer, HookConfigSource } from "./hooks/types.js";

/** Project / user config directory basename (brand default). */
export const ASTRAVIA_HOOK_CONFIG_DIR_NAME = ".astravia";

export interface BuildDefaultHookConfigLayersOptions {
	/** Session project working directory. */
	cwd: string;
	/**
	 * Astravia user data root.
	 * Default: `~/.astravia` (HOME / USERPROFILE / os.homedir()).
	 * Coding Agent should pass `getAstraviaHomePath()` so `ASTRAVIA_HOME` applies.
	 */
	astraviaHome?: string;
	/**
	 * Project config directory name under cwd. Default: `.astravia`.
	 * Override only for tests or non-standard layouts.
	 */
	configDirName?: string;
	/**
	 * Override home directory (tests). Default: HOME / USERPROFILE / os.homedir().
	 * Used only when `astraviaHome` is omitted.
	 */
	homeDir?: string;
	/** Environment for HOME resolution. Default process.env. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Build host config layers for ecosystem hook discovery under Astravia paths only.
 *
 * Mirrors official Codex/Claude directory layout **inside** Astravia roots:
 *
 * 1. User:
 *    - `<astraviaHome>/.codex/hooks.json`
 *    - `<astraviaHome>/.claude/settings.json`
 * 2. Project:
 *    - `<cwd>/.astravia/.codex/hooks.json`
 *    - `<cwd>/.astravia/.claude/settings.json`
 *    - `<cwd>/.astravia/.claude/settings.local.json`
 *
 * Does **not** read top-level official homes (`~/.codex`, `~/.claude`, project
 * `.codex` / `.claude` at cwd root). Hosts that need those must pass explicit layers.
 *
 * Each source carries `profileId` so Codex and Claude adapters never claim each other's files.
 * Missing files are ignored at discovery time (ENOENT).
 *
 * File formats match the original ecosystems (Codex `hooks.json`; Claude settings with `"hooks"`).
 */
export function buildDefaultHookConfigLayers(options: BuildDefaultHookConfigLayersOptions): HookConfigLayer[] {
	const env = options.env ?? process.env;
	const homeDir = options.homeDir ?? resolveHomeDir(env);
	const astraviaHome = options.astraviaHome ?? join(homeDir, ASTRAVIA_HOOK_CONFIG_DIR_NAME);
	const configDirName = options.configDirName ?? ASTRAVIA_HOOK_CONFIG_DIR_NAME;
	const projectAstraviaDir = join(options.cwd, configDirName);

	const userCodexDir = join(astraviaHome, ".codex");
	const userClaudeDir = join(astraviaHome, ".claude");
	const projectCodexDir = join(projectAstraviaDir, ".codex");
	const projectClaudeDir = join(projectAstraviaDir, ".claude");

	return [
		{
			directory: userCodexDir,
			enabled: true,
			label: "astravia-user-codex",
			sources: [codexSource(join(userCodexDir, "hooks.json"))],
		},
		{
			directory: userClaudeDir,
			enabled: true,
			label: "astravia-user-claude",
			sources: [claudeSource(join(userClaudeDir, "settings.json"))],
		},
		{
			directory: projectCodexDir,
			enabled: true,
			label: "astravia-project-codex",
			sources: [codexSource(join(projectCodexDir, "hooks.json"))],
		},
		{
			directory: projectClaudeDir,
			enabled: true,
			label: "astravia-project-claude",
			sources: [
				claudeSource(join(projectClaudeDir, "settings.json")),
				claudeSource(join(projectClaudeDir, "settings.local.json")),
			],
		},
	];
}

function codexSource(path: string): HookConfigSource {
	return { path, profileId: LATEST_CODEX_HOOK_PROFILE_ID };
}

function claudeSource(path: string): HookConfigSource {
	return { path, profileId: CLAUDE_CODE_HOOK_PROFILE_ID };
}

function resolveHomeDir(env: NodeJS.ProcessEnv): string {
	const fromEnv = env.HOME || env.USERPROFILE;
	if (fromEnv && fromEnv.length > 0) return fromEnv;
	return homedir();
}
