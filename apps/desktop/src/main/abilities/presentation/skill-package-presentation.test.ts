import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillPackagePresentationIcon, readDeclaredSkillIconReference } from "./skill-package-presentation";

const temporaryRoots: string[] = [];

async function createSkill(frontmatter: string): Promise<{ root: string; filePath: string }> {
	const root = await mkdtemp(join(tmpdir(), "vetta-skill-presentation-test-"));
	temporaryRoots.push(root);
	const filePath = join(root, "SKILL.md");
	await writeFile(filePath, `---\n${frontmatter}\n---\n`, "utf-8");
	return { root, filePath };
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readDeclaredSkillIconReference", () => {
	it("only reads the namespaced Vetta presentation field", () => {
		expect(readDeclaredSkillIconReference("---\nicon: assets/wrong.svg\n---\n")).toBeUndefined();
		expect(
			readDeclaredSkillIconReference(
				"---\nmetadata:\n  vetta:\n    presentation:\n      icon: assets/icon.svg\n---\n",
			),
		).toBe("assets/icon.svg");
		expect(readDeclaredSkillIconReference("no frontmatter")).toBeUndefined();
	});

	it("ignores non-string and blank declarations", () => {
		expect(
			readDeclaredSkillIconReference("---\nmetadata:\n  vetta:\n    presentation:\n      icon: 42\n---\n"),
		).toBeUndefined();
		expect(
			readDeclaredSkillIconReference("---\nmetadata:\n  vetta:\n    presentation:\n      icon: '   '\n---\n"),
		).toBeUndefined();
	});
});

describe("loadSkillPackagePresentationIcon", () => {
	it("keeps Iconify and HTTPS references without touching the filesystem", async () => {
		const symbol = await createSkill("metadata:\n  vetta:\n    presentation:\n      icon: solar:rocket-bold");
		expect(loadSkillPackagePresentationIcon({ filePath: symbol.filePath, baseDir: symbol.root })).toBe(
			"solar:rocket-bold",
		);
		const remote = await createSkill(
			"metadata:\n  vetta:\n    presentation:\n      icon: https://example.com/icon.png",
		);
		expect(loadSkillPackagePresentationIcon({ filePath: remote.filePath, baseDir: remote.root })).toBe(
			"https://example.com/icon.png",
		);
	});

	it("resolves a package image through the caller-owned URL adapter", async () => {
		const skill = await createSkill("metadata:\n  vetta:\n    presentation:\n      icon: assets/icon.svg");
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
		const skill = await createSkill(`metadata:\n  vetta:\n    presentation:\n      icon: ${reference}`);
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
