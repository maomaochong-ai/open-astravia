import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = resolve(import.meta.dirname, "..");
const skillPath = "agent/skills/vetta-apple-app-dev-guide";
const skillDir = resolve(pluginRoot, skillPath);

/** components-index.md 里「还没写、需要时新建」的占位条目，不是坏链。 */
const PLANNED_REFERENCES = new Set([
	"references/composer.md",
	"references/design-system.md",
	"references/text-input.md",
	"references/webview.md",
]);

async function listMarkdown(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => resolve(entry.parentPath, entry.name));
}

describe("vetta-apple-app-dev-guide skill", () => {
	it("ships exactly one SKILL.md", async () => {
		// 多个 skill 会各自把 frontmatter 常驻进上下文；本插件刻意只暴露一个入口，
		// 所有指南都靠 references/ 渐进展开。
		const skillFiles = (await listMarkdown(skillDir)).filter((file) => basename(file) === "SKILL.md");
		expect(skillFiles).toEqual([resolve(skillDir, "SKILL.md")]);
	});

	it("names itself after the directory the manifest points at", async () => {
		const source = await readFile(resolve(skillDir, "SKILL.md"), "utf8");
		expect(source.startsWith("---\n")).toBe(true);
		const frontmatter = source.slice(4, source.indexOf("\n---\n", 3));
		expect(frontmatter).toContain("name: vetta-apple-app-dev-guide");
		expect(frontmatter).toMatch(/^description: .+/m);
	});

	it("routes to references that exist", async () => {
		const files = await listMarkdown(skillDir);
		const missing: string[] = [];
		for (const file of files) {
			const source = await readFile(file, "utf8");
			for (const match of source.matchAll(/references\/[A-Za-z0-9._-]+\.md/g)) {
				const target = match[0];
				if (PLANNED_REFERENCES.has(target)) continue;
				const exists = files.includes(resolve(skillDir, target));
				if (!exists) missing.push(`${basename(file)} -> ${target}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("drives the simulator through baguette and xcrun, not XcodeBuildMCP", async () => {
		// 指南是从一份基于 XcodeBuildMCP 的 skill 改写来的；工具名残留会让模型去调
		// 本插件根本没有注册的 MCP 工具。
		const files = await listMarkdown(skillDir);
		const leaked: string[] = [];
		for (const file of files) {
			if (/XcodeBuildMCP/.test(await readFile(file, "utf8"))) leaked.push(basename(file));
		}
		expect(leaked).toEqual([]);
	});
});
