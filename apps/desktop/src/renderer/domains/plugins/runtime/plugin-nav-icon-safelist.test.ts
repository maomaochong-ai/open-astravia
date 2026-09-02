import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPluginNavIcon } from "./plugin-nav-icon";

/**
 * 侧边栏导航图标最终是一条 class 字符串，而 Tailwind 只生成**它扫得到的字面量**。
 * 插件源码不在宿主的扫描范围内，所以系统插件用到的 iconify class 必须在
 * renderer/styles.css 里逐条 `@source inline(...)` 放行，否则那条 class 没有规则、
 * 导航项渲染成一个空格子——没有报错，只是图标不见了。
 *
 * 这个守卫把「插件声明了图标」和「宿主生成了规则」绑在一起：新增会注册工作区视图的
 * 系统插件时，忘了补 styles.css 会在这里失败，而不是等到有人截图才发现。
 */

const repoRoot = resolve(import.meta.dirname, "../../../../../../..");
const presetsDir = join(repoRoot, "packages/plugins/presets");
const stylesPath = join(repoRoot, "apps/desktop/src/renderer/styles.css");

const ICON_LITERAL = /icon:\s*"([^"]+)"/g;

function readSourceFiles(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			readSourceFiles(full, files);
			continue;
		}
		if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/** iconify class strings a preset hands to the host for its sidebar nav entry. */
function navIconClassesOf(presetDir: string): string[] {
	const srcDir = join(presetDir, "src");
	const sources = readSourceFiles(srcDir).map((file) => readFileSync(file, "utf8"));
	if (!sources.some((source) => source.includes("registerWorkspaceView"))) return [];

	const candidates: string[] = [];
	// 未声明 icon 时宿主回落到 plugin.json 的图标，所以它同样要能渲染。
	const manifest = JSON.parse(readFileSync(join(presetDir, "plugin.json"), "utf8")) as { icon?: string };
	if (manifest.icon) candidates.push(manifest.icon);
	for (const source of sources) {
		for (const match of source.matchAll(ICON_LITERAL)) candidates.push(match[1]);
	}

	const classes = new Set<string>();
	for (const candidate of candidates) {
		// 打包图片走运行时 mask class，不需要 Tailwind 生成；只有 iconify class 需要。
		if (!candidate.startsWith("icon-[") && !/^[a-z0-9-]+:[a-z0-9-]+$/i.test(candidate)) continue;
		const classified = classifyPluginNavIcon(candidate);
		if (classified?.kind === "class") classes.add(classified.value);
	}
	return [...classes];
}

describe("preset sidebar nav icons", () => {
	it("are all safelisted in renderer/styles.css", () => {
		const styles = readFileSync(stylesPath, "utf8");
		const missing: string[] = [];
		for (const entry of readdirSync(presetsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			for (const className of navIconClassesOf(join(presetsDir, entry.name))) {
				if (!styles.includes(`@source inline("${className}")`)) missing.push(`${entry.name}: ${className}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("covers at least the presets that contribute a workspace view", () => {
		// 上面那条断言在「一个都没扫到」时也会通过；这里确保扫描真的看到了东西。
		const covered = readdirSync(presetsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.flatMap((entry) => navIconClassesOf(join(presetsDir, entry.name)));
		expect(covered.length).toBeGreaterThan(0);
	});
});
