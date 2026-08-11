import { DEFAULT_CONFIG_DIR_NAME, getVettaHomePath } from "@vetta/action-rpc";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export { getVettaHomePath } from "@vetta/action-rpc";

declare const VETTA_COMPILED_PACKAGE_METADATA: unknown;

// =============================================================================
// Package Detection
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Detect if Bun is the runtime (compiled binary or bun run) */
export const isBunRuntime = !!process.versions.bun;

// =============================================================================
// Install Method Detection
// =============================================================================

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export function detectInstallMethod(): InstallMethod {
	if (isBunBinary) {
		return "bun-binary";
	}

	const resolvedPath = `${__dirname}\0${process.execPath || ""}`.toLowerCase();

	if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/") || resolvedPath.includes("\\pnpm\\")) {
		return "pnpm";
	}
	if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/") || resolvedPath.includes("\\yarn\\")) {
		return "yarn";
	}
	if (isBunRuntime) {
		return "bun";
	}
	if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/") || resolvedPath.includes("\\npm\\")) {
		return "npm";
	}

	return "unknown";
}

export function getUpdateInstruction(packageName: string): string {
	const method = detectInstallMethod();
	switch (method) {
		case "bun-binary":
			return "Update via your internal release channel";
		case "pnpm":
			return `Run: pnpm install -g ${packageName}`;
		case "yarn":
			return `Run: yarn global add ${packageName}`;
		case "bun":
			return `Run: bun install -g ${packageName}`;
		case "npm":
			return `Run: npm install -g ${packageName}`;
		default:
			return `Run: npm install -g ${packageName}`;
	}
}

// =============================================================================
// Package Asset Paths (shipped with executable)
// =============================================================================

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns __dirname (the dist/ directory)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	// Bootstrap-time env lookup: avoid referencing ENV_PACKAGE_DIR before APP_NAME is initialized.
	const envDir = process.env.VETTA_PACKAGE_DIR || process.env.PI_PACKAGE_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}

	if (isBunBinary) {
		// Bun binary: process.execPath points to the compiled executable
		return dirname(process.execPath);
	}
	// Node.js: walk up from __dirname until we find package.json
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	// Fallback (shouldn't happen)
	return __dirname;
}

/**
 * Get path to built-in themes directory (shipped with package)
 * - For Bun binary: theme/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/theme/
 * - For tsx (src/): src/modes/interactive/theme/
 */
export function getThemesDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "theme");
	}
	// Theme is in modes/interactive/theme/ relative to src/ or dist/
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

/**
 * Get path to HTML export template directory (shipped with package)
 * - For Bun binary: export-html/ next to executable
 * - For Node.js (dist/): dist/export-html/
 * - For tsx (src/): src/export-html/assets/
 */
export function getExportTemplateDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "export-html");
	}
	const packageDir = getPackageDir();
	return existsSync(join(packageDir, "src"))
		? join(packageDir, "src", "export-html", "assets")
		: join(packageDir, "dist", "export-html");
}

/** Get path to package.json */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/** Get path to README.md */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/** Get path to docs directory */
export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

/** Get path to examples directory */
export function getExamplesPath(): string {
	return resolve(join(getPackageDir(), "examples"));
}

/** Get path to CHANGELOG.md */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

// =============================================================================
// App Config (from package.json piConfig)
// =============================================================================

interface CodingAgentPackageMetadata {
	readonly name: string;
	readonly version: string;
	readonly piConfig?: {
		readonly name: string;
	};
}

function parsePackageMetadata(value: unknown): CodingAgentPackageMetadata | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const name = Reflect.get(value, "name");
	const version = Reflect.get(value, "version");
	if (typeof name !== "string" || typeof version !== "string") return undefined;
	const rawPiConfig = Reflect.get(value, "piConfig");
	const appName =
		typeof rawPiConfig === "object" && rawPiConfig !== null ? Reflect.get(rawPiConfig, "name") : undefined;
	return {
		name,
		version,
		piConfig: typeof appName === "string" ? { name: appName } : undefined,
	};
}

function loadPackageMetadata(): CodingAgentPackageMetadata {
	const packageJsonPath = getPackageJsonPath();
	if (existsSync(packageJsonPath)) {
		const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
		const metadata = parsePackageMetadata(parsed);
		if (metadata) return metadata;
		throw new Error(`Invalid coding-agent package metadata: ${packageJsonPath}`);
	}
	if (isBunBinary && typeof VETTA_COMPILED_PACKAGE_METADATA !== "undefined") {
		const metadata = parsePackageMetadata(VETTA_COMPILED_PACKAGE_METADATA);
		if (metadata) return metadata;
	}
	throw new Error(`Coding-agent package metadata not found: ${packageJsonPath}`);
}

const pkg = loadPackageMetadata();

export const PACKAGE_NAME: string = pkg.name;
export const APP_NAME: string = pkg.piConfig?.name ?? "vetta";
// 项目内配置目录名（cwd/<name>），用品牌默认名，不随 VETTA_CONFIG_DIR 变化。
// home 根目录名才受 VETTA_CONFIG_DIR 覆盖（见 action-rpc 的 getVettaHomePath）。
export const CONFIG_DIR_NAME: string = DEFAULT_CONFIG_DIR_NAME;
export const VERSION: string = pkg.version;

// e.g., PI_CODING_AGENT_DIR or TAU_CODING_AGENT_DIR
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_PACKAGE_DIR = `${APP_NAME.toUpperCase()}_PACKAGE_DIR`;
export const ENV_SHARE_VIEWER_URL = `${APP_NAME.toUpperCase()}_SHARE_VIEWER_URL`;
export const ENV_SERVER_URL = `${APP_NAME.toUpperCase()}_SERVER_URL`;

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

/** Default server URL for remote provider/model configs */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:8080/api/v1";

/** Get the share viewer URL for a gist ID */
export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env[ENV_SHARE_VIEWER_URL] || process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

// =============================================================================
// User Config Paths (~/.pi/agent/*)
// =============================================================================

/** Get the agent config directory (e.g., ~/.pi/agent/) */
export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		// Expand tilde to home directory
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}
	return join(getVettaHomePath(), "agent");
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

/** Get path to models.json */
export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

/** Get path to auth.json */
export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

/** Get path to settings.json */
export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

/** Get path to managed binaries directory (fd, rg) */
export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

/** Get path to prompt templates directory */
export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}

/** Get the scene directory (e.g., ~/.vetta/scene/) */
export function getSceneDir(): string {
	return join(getVettaHomePath(), "scene");
}

/** Get the user-level skills directory (e.g., ~/.vetta/skills/) */
export function getUserSkillsDir(): string {
	return join(getVettaHomePath(), "skills");
}

/** Get the knowledge base root directory (e.g., ~/.vetta/knowledges/) */
export function getKnowledgeDir(): string {
	return join(getVettaHomePath(), "knowledges");
}
