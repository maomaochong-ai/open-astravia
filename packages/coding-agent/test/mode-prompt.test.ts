/**
 * mode 提示词的事实源合同。
 *
 * `src/profiles/modes/*.md` 是唯一编辑来源，`modes-data.ts` 是 `scripts/generate-modes.mjs`
 * 的产物。手改产物在类型层完全看不出来，但会让「改了 md 却不生效」变成静默故障，
 * 所以这里按事实源逐条比对。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getModePrompt, MODE_PROMPTS } from "../src/profiles/mode-prompt.js";

const modesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "profiles", "modes");

/** 与 generate-modes.mjs 相同的 frontmatter 切分：正文 = 第二个 `---` 之后。 */
function readModeFile(file: string): { id: string; body: string } {
	const normalized = readFileSync(join(modesDir, file), "utf-8").replace(/\r\n?/g, "\n");
	const end = normalized.indexOf("\n---", 3);
	const frontmatter = normalized.slice(4, end);
	const id = /^id:\s*(\S+)$/m.exec(frontmatter)?.[1];
	if (!id) throw new Error(`${file} 缺少 id`);
	return { id, body: normalized.slice(end + 4).trim() };
}

const modeFiles = readdirSync(modesDir)
	.filter((file) => file.endsWith(".md"))
	.sort()
	.map(readModeFile);

describe("mode 提示词与 .md 事实源", () => {
	it("生成产物覆盖全部 .md，且正文逐字一致", () => {
		expect(modeFiles.length).toBeGreaterThan(0);
		expect(MODE_PROMPTS.map((mode) => mode.id).sort()).toEqual(modeFiles.map((mode) => mode.id).sort());
		for (const { id, body } of modeFiles) {
			expect(getModePrompt(id), `mode ${id} 的 modes-data.ts 已过期，跑 bun run generate:modes`).toBe(body);
		}
	});

	it("未知 / 未传 mode 不追加 mode block", () => {
		expect(getModePrompt(undefined)).toBe("");
		expect(getModePrompt("not-a-mode")).toBe("");
	});
});

describe("路径声明（方案 1.3）", () => {
	it("coding 模式声明 UI 工作默认走代码库，设计探索工具需用户明确要求", () => {
		const coding = getModePrompt("coding");
		expect(coding).toContain("## Default route for UI work");
		// 三条缺一不可：默认路线、设计工具的准入门槛、不得自行改道。
		expect(coding).toMatch(/UI and page work happens in the current codebase/);
		expect(coding).toMatch(/design-exploration tools/i);
		expect(coding).toMatch(/Never switch routes on your own/);
	});

	it("work 模式声明何时应转向代码实现", () => {
		const work = getModePrompt("work");
		expect(work).toContain("## When to Switch to the Code Route");
		expect(work).toMatch(/Switch to implementing inside the user's codebase/);
	});
});
