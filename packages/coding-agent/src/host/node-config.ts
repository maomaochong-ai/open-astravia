import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getVettaHomePath } from "@vetta/action-rpc";
import { APP_NAME, ENV_AGENT_DIR, ENV_PACKAGE_DIR, ENV_SHARE_VIEWER_URL, PACKAGE_NAME } from "../identity.js";

export { getVettaHomePath } from "@vetta/action-rpc";

declare const VETTA_COMPILED_PACKAGE_METADATA: unknown;

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

/** Whether the current Node-compatible host is running from a Bun compiled binary. */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Whether Bun is the current JavaScript runtime. */
export const isBunRuntime = Boolean(process.versions.bun);

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export function detectInstallMethod(): InstallMethod {
	if (isBunBinary) return "bun-binary";
	const resolvedPath = `${moduleDirectory}\0${process.execPath || ""}`.toLowerCase();
	if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/") || resolvedPath.includes("\\pnpm\\")) {
		return "pnpm";
	}
	if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/") || resolvedPath.includes("\\yarn\\")) {
		return "yarn";
	}
	if (isBunRuntime) return "bun";
	if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/") || resolvedPath.includes("\\npm\\")) {
		return "npm";
	}
	return "unknown";
}

export function getUpdateInstruction(packageName: string): string {
	switch (detectInstallMethod()) {
		case "bun-binary":
			return "Update via your internal release channel";
		case "pnpm":
			return `Run: pnpm install -g ${packageName}`;
		case "yarn":
			return `Run: yarn global add ${packageName}`;
		case "bun":
			return `Run: bun install -g ${packageName}`;
		case "npm":
		case "unknown":
			return `Run: npm install -g ${packageName}`;
	}
}

export function getPackageDir(): string {
	const configuredDirectory = process.env[ENV_PACKAGE_DIR] || process.env.PI_PACKAGE_DIR;
	if (configuredDirectory) return expandHomeDirectory(configuredDirectory);
	if (isBunBinary) return dirname(process.execPath);

	let directory = moduleDirectory;
	while (directory !== dirname(directory)) {
		if (existsSync(join(directory, "package.json"))) return directory;
		directory = dirname(directory);
	}
	return moduleDirectory;
}

export function getThemesDir(): string {
	if (isBunBinary) return join(dirname(process.execPath), "theme");
	const packageDirectory = getPackageDir();
	const sourceDirectory = existsSync(join(packageDirectory, "src")) ? "src" : "dist";
	return join(packageDirectory, sourceDirectory, "modes", "interactive", "theme");
}

export function getExportTemplateDir(): string {
	if (isBunBinary) return join(dirname(process.execPath), "export-html");
	const packageDirectory = getPackageDir();
	return existsSync(join(packageDirectory, "src"))
		? join(packageDirectory, "src", "export-html", "assets")
		: join(packageDirectory, "dist", "export-html");
}

export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

export function getReadmePath(): string {
	return resolve(getPackageDir(), "README.md");
}

export function getDocsPath(): string {
	return resolve(getPackageDir(), "docs");
}

export function getExamplesPath(): string {
	return resolve(getPackageDir(), "examples");
}

export function getChangelogPath(): string {
	return resolve(getPackageDir(), "CHANGELOG.md");
}

interface CodingAgentPackageMetadata {
	readonly name: string;
	readonly version: string;
}

/**
 * 宿主把 coding-agent 打进自己的 bundle 时（Electron asar 等），`getPackageDir()`
 * 的 walk-up 只能找到宿主自己的 package.json。那不是本包的清单，读不出版本号，
 * 但也绝不能让宿主进程在模块求值阶段崩溃——VERSION 只用于 MCP clientVersion 和
 * CLI 版本展示，缺失时降级即可。
 */
const UNKNOWN_VERSION = "0.0.0";

function parsePackageMetadata(value: unknown): CodingAgentPackageMetadata | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const name = Reflect.get(value, "name");
	const version = Reflect.get(value, "version");
	return typeof name === "string" && typeof version === "string" ? { name, version } : undefined;
}

/** 只接受确实属于本包的清单，其余一律降级为未知版本。 */
export function resolveCodingAgentVersion(manifest: unknown): string {
	const metadata = parsePackageMetadata(manifest);
	return metadata?.name === PACKAGE_NAME ? metadata.version : UNKNOWN_VERSION;
}

function loadPackageManifest(): unknown {
	const packageJsonPath = getPackageJsonPath();
	if (existsSync(packageJsonPath)) {
		try {
			return JSON.parse(readFileSync(packageJsonPath, "utf8"));
		} catch {
			return undefined;
		}
	}
	if (isBunBinary && typeof VETTA_COMPILED_PACKAGE_METADATA !== "undefined") return VETTA_COMPILED_PACKAGE_METADATA;
	return undefined;
}

export const VERSION = resolveCodingAgentVersion(loadPackageManifest());

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env[ENV_SHARE_VIEWER_URL] || process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

export function getAgentDir(): string {
	const configuredDirectory = process.env[ENV_AGENT_DIR];
	return configuredDirectory ? expandHomeDirectory(configuredDirectory) : join(getVettaHomePath(), "agent");
}

export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}

export function getSceneDir(): string {
	return join(getVettaHomePath(), "scene");
}

export function getUserSkillsDir(): string {
	return join(getVettaHomePath(), "skills");
}

export function getKnowledgeDir(): string {
	return join(getVettaHomePath(), "knowledges");
}

function expandHomeDirectory(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
