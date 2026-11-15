import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillPackagePresentationIcon, readDeclaredSkillIconReference } from "./skill-package-presentation";

const temporaryRoots: string[] = [];

async function createSkill(frontmatter: string): Promise<{ root: string; filePath: string }> {
	const root = await mkdtemp(join(tmpdir(), "astravia-skill-presentation-test-"));
	temporaryRoots.push(root);
	const filePath = join(root, "SKILL.md");
	await writeFile(filePath, `---\n${frontmatter}\n---\n`, "utf-8");
	return { root, filePath };
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readDeclaredSkillIconReference", () => {
	it("only reads the namespaced Astravia presentation field", () => {
		expect(readDeclaredSkillIconReference("---\nicon: assets/wrong.svg\n---\n")).toBeUndefined();
		expect(
			readDeclaredSkillIconReference(
				"---\nmetadata:\n  astravia:\n    presentation:\n      icon: assets/icon.svg\n---\n",
			),
		).toBe("assets/icon.svg");
		expect(readDeclaredSkillIconReference("no frontmatter")).toBeUndefined();
	});

	it("ignores non-string and blank declarations", () => {
		expect(
			readDeclaredSkillIconReference("---\nmetadata:\n  astravia:\n    presentation:\n      icon: 42\n---\n"),
		).toBeUndefined();
		expect(
			readDeclaredSkillIconReference("---\nmetadata:\n  astravia:\n    presentation:\n      icon: '   '\n---\n"),
		).toBeUndefined();
	});
});

describe("loadSkillPackagePresentationIcon", () => {
	it("keeps Iconify and HTTPS references without touching the filesystem", async () => {
		const symbol = await createSkill("metadata:\n  astravia:\n    presentation:\n      icon: solar:rocket-bold");
		expect(loadSkillPackagePresentationIcon({ filePath: symbol.filePath, baseDir: symbol.root })).toBe(
			"solar:rocket-bold",
		);
		const remote = await createSkill(
			"metadata:\n  astravia:\n    presentation:\n      icon: https://example.com/icon.png",
		);
		expect(loadSkillPackagePresentationIcon({ filePath: remote.filePath, baseDir: remote.root })).toBe(
			"https://example.com/icon.png",
		);
	});

	it("resolves a package image through the caller-owned URL adapter", async () => {
		const skill = await createSkill("metadata:\n  astravia:\n    presentation:\n      icon: assets/icon.svg");
		await mkdir(join(skill.root, "assets"));
		await writeFile(join(skill.root, "assets", "icon.svg"), "<svg/>", "utf-8");

		const icon = loadSkillPackagePresentationIcon({
			filePath: skill.filePath,
			baseDir: skill.root,
			assetUrlResolver: (_absolutePath, relativePath) => `test://${relativePath}`,
		});

		expect(icon).toBe("test://assets/icon.svg");
	});

	it.each([
		["../outside.svg", "escapes ability source"],
		["assets/readme.txt", "Unsupported presentation image type"],
		["file:///tmp/icon.svg", "Unsupported presentation asset protocol"],
	])("rejects unsafe or unsupported reference %s", async (reference, message) => {
		const skill = await createSkill(`metadata:\n  astravia:\n    presentation:\n      icon: ${reference}`);
		await mkdir(join(skill.root, "assets"), { recursive: true });
		await writeFile(join(skill.root, "assets", "readme.txt"), "not an image", "utf-8");
		expect(() => loadSkillPackagePresentationIcon({ filePath: skill.filePath, baseDir: skill.root })).toThrow(
			message,
		);
	});

	it("surfaces malformed YAML to the resource boundary for per-package degradation", async () => {
		const skill = await createSkill("metadata: [");
		expect(() => loadSkillPackagePresentationIcon({ filePath: skill.filePath, baseDir: skill.root })).toThrow();
	});
});

describe("loadSkillPackagePresentationIcon", () => {
	const resolve = (absolutePath: string): string => `asset://${absolutePath}`;

	it("frontmatter 没声明时回退同目录 ability.json 的 icon", async () => {
		const { root, filePath } = await createSkill("name: xlsx");
		await mkdir(join(root, "assets"), { recursive: true });
		await writeFile(join(root, "assets/icon.png"), "png", "utf-8");
		await writeFile(join(root, "ability.json"), JSON.stringify({ type: "skill", icon: "assets/icon.png" }), "utf-8");

		const icon = loadSkillPackagePresentationIcon({ filePath, baseDir: root, assetUrlResolver: resolve });

		// 回归：市场安装的技能只在 ability.json 里声明图标，缺这条回退时技能清单没有图标，
		// 添加面板与 `/` 菜单只能显示默认图。
		expect(icon).toBe(`asset://${root}/assets/icon.png`);
	});

	it("frontmatter 的 namespaced 声明优先于 ability.json", async () => {
		const { root, filePath } = await createSkill(
			"metadata:\n  astravia:\n    presentation:\n      icon: assets/from-md.png",
		);
		await mkdir(join(root, "assets"), { recursive: true });
		await writeFile(join(root, "assets/from-md.png"), "png", "utf-8");
		await writeFile(join(root, "ability.json"), JSON.stringify({ icon: "assets/from-json.png" }), "utf-8");

		expect(loadSkillPackagePresentationIcon({ filePath, baseDir: root, assetUrlResolver: resolve })).toBe(
			`asset://${root}/assets/from-md.png`,
		);
	});

	it("两处都没有图标时返回 undefined（由视图落默认图）", async () => {
		const { root, filePath } = await createSkill("name: plain");
		expect(loadSkillPackagePresentationIcon({ filePath, baseDir: root, assetUrlResolver: resolve })).toBeUndefined();
	});
});
