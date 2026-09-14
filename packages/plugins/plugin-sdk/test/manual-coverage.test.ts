import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLUGIN_PERMISSIONS } from "../src/permissions.js";

/**
 * 手册是 Agent 写插件时唯一的依据，而合同长在代码里：新增一个权限或 UI 槽位，手册漏记
 * 的后果不是「文档不全」，而是这项能力对 Agent 根本不存在。靠人记得改已经在失效——
 * 这几条断言把清单面钉在真源上，散文仍然由人写。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const manualDir = join(repoRoot, "docs", "plugin");
function manualFileNames(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".md"))
		.sort();
}

function readManual(dir: string, name: string): string {
	return readFileSync(join(dir, name), "utf8");
}

const permissionsDoc = readManual(manualDir, "permissions.md");
const wholeManual = manualFileNames(manualDir)
	.map((name) => readManual(manualDir, name))
	.join("\n");

describe("plugin manual coverage", () => {
	it("documents every declared permission", () => {
		const undocumented = PLUGIN_PERMISSIONS.filter((permission) => !permissionsDoc.includes(`\`${permission}\``));
		expect(undocumented).toEqual([]);
	});

	it("mentions every ui registration method somewhere in the manual", () => {
		const uiSource = readFileSync(join(here, "..", "src", "ui.ts"), "utf8");
		const apiBlock = uiSource.split("export interface PluginUiApi {")[1];
		expect(apiBlock, "PluginUiApi interface moved or was renamed").toBeDefined();
		const body = apiBlock!.split("\n}\n")[0] ?? "";
		const methods = [...new Set([...body.matchAll(/^\t(register[A-Za-z]+)\(/gm)].map((match) => match[1]!))];
		// 找不到方法说明解析方式失效了，而不是「刚好一个都没有」。
		expect(methods.length).toBeGreaterThan(0);

		const undocumented = methods.filter((method) => !wholeManual.includes(method));
		expect(undocumented).toEqual([]);
	});

	it("ships the manual inside the npm tarball", () => {
		// 手册随包发布是「任意目录里的 Agent 都能拿到版本对齐的合同」的地基：
		// 漏掉 files 里这一项，装包的人拿到的 node_modules 里就没有 docs/。
		const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
			files?: string[];
			scripts?: Record<string, string>;
		};
		expect(pkg.files ?? []).toContain("docs");
		// prepack 保证即使有人跳过 build 直接 npm publish，tarball 里的手册也是最新的。
		expect(pkg.scripts?.prepack).toContain("bundle-docs");
	});

});
