import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * 定位「当前在开发哪个插件」与「手册在哪」。
 *
 * 这两件事都不能让调用方（尤其是 Agent）靠硬编码路径解决：插件既可能是一个独立工程，
 * 也可能是能力市场那种一仓多插件的 hub；依赖既可能装在插件目录下，也可能被工作区提升到
 * 仓库根。把它们收敛成一次向上查找，命令在任何子目录里执行都得到同一个答案。
 */

/** 到此为止不再往上找：再往上就出了用户的项目，撞进无关仓库或用户主目录。 */
const BOUNDARY_MARKERS = [".git"] as const;
const MAX_WALK_DEPTH = 32;

export interface PluginProject {
	/** 含 plugin.json 的目录。 */
	readonly root: string;
	readonly pluginId: string;
	readonly version: string;
}

export interface PluginHub {
	/** 含 .vetta/marketplace.json 的仓库根。 */
	readonly root: string;
	readonly manifestPath: string;
}

function* walkUp(from: string): Generator<string> {
	let current = resolve(from);
	for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
		yield current;
		const parent = dirname(current);
		if (parent === current) return;
		current = parent;
	}
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/**
 * 从 `from` 向上找最近的插件工程。
 *
 * 「最近」是刻意的：在 hub 里 `cd plugins/foo && … ` 命中 foo，而不是仓库根——用户站在
 * 哪个插件里，操作就作用于哪个插件。
 */
export function findPluginProject(from: string): PluginProject | undefined {
	for (const dir of walkUp(from)) {
		const manifestPath = join(dir, "plugin.json");
		if (!existsSync(manifestPath)) {
			if (isBoundary(dir)) return undefined;
			continue;
		}
		const manifest = readJson(manifestPath);
		const pluginId = typeof manifest?.id === "string" ? manifest.id : undefined;
		if (!pluginId) return undefined;
		return {
			root: dir,
			pluginId,
			version: typeof manifest?.version === "string" ? manifest.version : "0.0.0",
		};
	}
	return undefined;
}

/** 从 `from` 向上找最近的能力市场 hub（`.vetta/marketplace.json`）。 */
export function findPluginHub(from: string): PluginHub | undefined {
	for (const dir of walkUp(from)) {
		const manifestPath = join(dir, ".vetta", "marketplace.json");
		if (existsSync(manifestPath)) return { root: dir, manifestPath };
		if (isBoundary(dir)) return undefined;
	}
	return undefined;
}

function isBoundary(dir: string): boolean {
	return BOUNDARY_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

/**
 * 解析随 `@vetta-org/plugin-sdk` 发布的手册目录。
 *
 * 按 Node 的解析规则逐层找 node_modules，因此工作区把依赖提升到仓库根、或每个插件各装
 * 一份，都能命中正确的那一份——也就是这个工程实际编译所针对的那个 SDK 版本的手册。
 */
export function resolveManualDir(from: string): string | undefined {
	for (const dir of walkUp(from)) {
		const candidate = join(dir, "node_modules", "@vetta-org", "plugin-sdk", "docs");
		if (existsSync(join(candidate, "README.md"))) return candidate;
	}
	return undefined;
}

/** 手册所属的 SDK 版本；用于告诉调用方「这份手册对应哪个合同」。 */
export function readManualSdkVersion(manualDir: string): string | undefined {
	const pkg = readJson(join(manualDir, "..", "package.json"));
	return typeof pkg?.version === "string" ? pkg.version : undefined;
}
