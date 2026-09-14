import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 发布到 npm 的包不能把 `workspace:` 协议留在运行时依赖里。
 *
 * 那是 bun/pnpm 的协议，npm 不认；`npm publish` 也不会像 `bun publish` 那样把它重写成真实
 * 版本号。发出去的后果是该版本在任何地方都装不上，而且 npm 报错时经常只留一行日志路径，
 * 排查成本很高——这一条已经让 capability-sdk 和 theme-ui 各踩过一次。
 *
 * 仓库内用 registry semver 同样解析到本地包（版本匹配即软链），所以这条限制没有代价。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

/** 会发到 npm 的包；新增可发布包时加进来。 */
const PUBLISHABLE = [
	"packages/capability-sdk",
	"packages/ui",
	"packages/theme-sdk",
	"packages/theme-ui",
	"packages/plugins/plugin-sdk",
	"packages/plugins/plugin-vite",
	"packages/plugins/plugin-cli",
] as const;

function readManifest(relativePath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(repoRoot, relativePath, "package.json"), "utf8")) as Record<string, unknown>;
}

function workspaceRanges(manifest: Record<string, unknown>, field: string): string[] {
	const deps = manifest[field];
	if (typeof deps !== "object" || deps === null || Array.isArray(deps)) return [];
	return Object.entries(deps as Record<string, string>)
		.filter(([, range]) => typeof range === "string" && range.startsWith("workspace:"))
		.map(([name]) => name);
}

describe("publishable package manifests", () => {
	it.each(PUBLISHABLE)("%s ships resolvable dependency ranges", (relativePath) => {
		const manifest = readManifest(relativePath);

		// devDependencies 不进 tarball，随便写；dependencies 与 peerDependencies 会跟着发出去。
		expect(workspaceRanges(manifest, "dependencies")).toEqual([]);
		expect(workspaceRanges(manifest, "peerDependencies")).toEqual([]);
	});

	it.each(PUBLISHABLE)("%s declares public publish access", (relativePath) => {
		const manifest = readManifest(relativePath);

		// scoped 包不声明就会按 restricted 发布，对开源包等于发不出去。
		expect((manifest.publishConfig as { access?: string } | undefined)?.access).toBe("public");
	});
});
