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
/** 随插件包发到用户机器上的那一份；生产环境没有 monorepo 的 docs/plugin。 */
const bundledDir = join(repoRoot, "packages", "plugins", "presets", "plugin-workbench", "agent", "docs", "plugin");

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

	it("keeps the copy bundled with the workbench in sync with the manual", () => {
		expect(manualFileNames(bundledDir)).toEqual(manualFileNames(manualDir));
		const drifted = manualFileNames(manualDir).filter(
			(name) => readManual(bundledDir, name) !== readManual(manualDir, name),
		);
		// 修复方式：node packages/plugins/presets/plugin-workbench/scripts/sync-plugin-docs.mjs
		expect(drifted).toEqual([]);
	});
});
