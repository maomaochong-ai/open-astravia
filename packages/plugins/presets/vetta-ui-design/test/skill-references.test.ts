/**
 * skill 正文按路径点名 references 文件，agent 照着路径去 Read。路径写错不会有任何
 * 构建报错，只会让 agent 在要用那条规则的时候读到一个不存在的文件，然后凭习惯继续
 * 干——恰好就是这些文件要纠正的那种习惯。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(__dirname, "../agent/skills/vetta-ui-design");

const referencedPaths = (text: string): string[] => [
	...new Set([...text.matchAll(/`(references\/[\w./-]+\.md)`/g)].map((match) => match[1])),
];

describe("vetta-ui-design skill references", () => {
	it("names only reference files that ship with the skill", () => {
		const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
		const paths = referencedPaths(skill);
		expect(paths).toContain("references/taste/directions.md");
		for (const path of paths) {
			expect(existsSync(join(SKILL_DIR, path)), `${path} is referenced by SKILL.md but missing`).toBe(true);
		}
	});

	it("keeps cross-references inside the reference files resolvable", () => {
		for (const file of ["references/quality.md", "references/taste/directions.md"]) {
			for (const path of referencedPaths(readFileSync(join(SKILL_DIR, file), "utf8"))) {
				expect(existsSync(join(SKILL_DIR, path)), `${path} is referenced by ${file} but missing`).toBe(true);
			}
		}
	});

	it("routes every new design through the direction step before the first frame", () => {
		const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
		const designer = readFileSync(join(__dirname, "../agent/agents/designer.md"), "utf8");
		// 缺了这一步，agent 会直接在脚手架的 indigo/slate 调色板上开画——正是 AI 味的来源。
		expect(skill).toMatch(/`vetd_create` with it → set the\s+direction → start building/);
		expect(designer).toContain("replace the scaffold palette before the first frame");
	});
});
