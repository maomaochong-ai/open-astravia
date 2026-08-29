import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateArticle } from "../vetta-blog/scripts/validate-blog.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("vetta-blog validator", () => {
	it("ships a marked article when evidence and visual review are complete", async () => {
		const directory = await makeDirectory();
		const articlePath = join(directory, "article.md");
		const evidencePath = join(directory, "evidence.json");
		const reviewPath = join(directory, "visual-review.json");
		const imagePath = join(directory, "hero.png");
		await writeFile(
			articlePath,
			`<!-- vetta-blog: article -->\n# Vetta 的本地工作流为什么需要可审查的交付\n\n这篇文章面向需要把任务交给 coding agent、又要保留文件和权限边界的开发者。结论来自一次真实复现。\n\n## 我在 Windows 上运行了什么\n\n<!-- claim:C1 -->我运行并测试了一个带 Skill hook 的 fixture，记录了输入、版本和观察到的反馈；源码和测试链接在这里：https://github.com/openvetta/open-vetta/blob/dev/packages/coding-agent/src/resources/skills/skill-document.ts。\n\n## 取舍：便利不等于所有权\n\n<!-- claim:C2 -->Vetta 的 local-first、BYOK、Skill、Plugin 和 MCP 路径让文件留在自己的环境里，但仍要面对模型服务和外部连接的网络边界。<!-- claim:C3 -->这个方案不适合需要多人实时画布的场景，局限已经记录。\n\n## 下一步怎么验证\n\n先读文档和源码，再用同一输入重跑一次，确认权限、artifact 和 Session 轨迹都能复查。\n`,
			"utf8",
		);
		await writeFile(
			evidencePath,
			JSON.stringify({
				observed_at: "2026-08-29",
				article_type: "comparison",
				comparison_protocol: {
					task: "同一 fixture 的 hook 反馈复核",
					input: "带 PostToolUse hook 的 Skill",
					criteria: ["可复现", "边界可审查"],
					stop_condition: "反馈与日志均可读取",
					deliverable_standard: "留下源码链接和日志 artifact",
				},
				competitors: [
					{
						name: "某云端 Agent",
						fit: "需要托管协作的团队",
						tradeoff: "数据边界和网络依赖更强",
						source_ids: ["S4", "S5"],
						experiment_ids: ["E1"],
					},
				],
				visual_required: true,
				claims: [
					{
						id: "C1",
						text: "Skill hook 读取 frontmatter hooks",
						importance: "high",
						status: "verified",
						evidence_ids: ["S1"],
						counterevidence_checked: true,
					},
					{
						id: "C2",
						text: "Vetta 的 local-first、BYOK 和 Skill 路径保留本地边界",
						importance: "medium",
						status: "verified",
						evidence_ids: ["S2"],
					},
					{
						id: "C3",
						text: "Vetta 不适合多人实时画布",
						importance: "medium",
						status: "verified",
						evidence_ids: ["S3"],
					},
				],
				sources: [
					{
						id: "S1",
						kind: "first_party_code",
						title: "skill-document",
						url: "https://github.com/openvetta/open-vetta/blob/dev/packages/coding-agent/src/resources/skills/skill-document.ts",
						accessed_at: "2026-08-29",
						supports: ["C1"],
					},
					{
						id: "S2",
						kind: "first_party_docs",
						title: "Vetta docs",
						url: "https://github.com/openvetta/open-vetta/blob/dev/docs/agent/coding-agent/README.md",
						accessed_at: "2026-08-29",
						supports: ["C2"],
					},
					{
						id: "S3",
						kind: "first_party_test",
						title: "Vetta tests",
						url: "https://github.com/openvetta/open-vetta/tree/dev/packages/coding-agent/test",
						accessed_at: "2026-08-29",
						supports: ["C3"],
					},
					{
						id: "S4",
						kind: "competitor_docs",
						title: "云端 Agent 官方文档",
						url: "https://example.com/competitor/docs",
						accessed_at: "2026-08-29",
						supports: ["C1"],
					},
					{
						id: "S5",
						kind: "competitor_release",
						title: "云端 Agent 官方发布说明",
						url: "https://example.com/competitor/release",
						accessed_at: "2026-08-28",
						supports: ["C1"],
					},
				],
				experiments: [
					{
						id: "E1",
						date: "2026-08-29",
						environment: "Windows 11, Vetta dev checkout",
						input: "带 PostToolUse hook 的 fixture Skill",
						steps: ["invoke_skill", "执行 Write", "读取 hook additionalContext"],
						observed: "hook 返回 additionalContext",
						result: "pass",
						retries: 0,
						claim_ids: ["C1", "C2", "C3"],
						artifact_paths: ["hook-test.log"],
					},
				],
				revision_log: [
					{
						issue: "初稿缺少 hook 失败边界",
						change: "补充 fail-open 条件",
						rechecked_claim_ids: ["C1", "C2", "C3"],
					},
				],
			}),
			"utf8",
		);
		await writeFile(imagePath, pngHeader(1600, 900));
		await writeFile(join(directory, "hero-b.png"), pngHeader(1600, 900));
		await writeFile(join(directory, "visual-brief.md"), "单一隐喻；标题安全区；米白、墨绿、珊瑚色。", "utf8");
		await writeFile(join(directory, "hook-test.log"), "additionalContext returned", "utf8");
		await writeFile(
			reviewPath,
			JSON.stringify({
				status: "approved",
				path: "hero.png",
				width: 1600,
				height: 900,
				checked_at: "2026-08-29",
				pixel_checked: true,
				brief_path: "visual-brief.md",
				candidates: [
					{ id: "A", path: "hero.png", axis: "构图" },
					{ id: "B", path: "hero-b.png", axis: "构图" },
				],
				selected_candidate_id: "A",
				selection_reason: "A 的标题留白和移动端焦点更稳定",
				checks: {
					article_thesis: "pass",
					vetta_palette_roles: "pass",
					title_safe_area: "pass",
					mobile_crop: "pass",
					legibility_and_artifacts: "pass",
				},
			}),
			"utf8",
		);

		const result = validateArticle(articlePath, { evidencePath, visualReviewPath: reviewPath });
		expect(result.verdict).toBe("SHIP");
		expect(result.errors).toEqual([]);
	});

	it("blocks an ungrounded generic draft", async () => {
		const directory = await makeDirectory();
		const articlePath = join(directory, "article.md");
		await writeFile(articlePath, "# AI 很棒\n\n我们很高兴宣布一个无缝、革命性的体验。", "utf8");
		const result = validateArticle(articlePath);
		expect(result.verdict).toBe("BLOCK");
		expect(result.errors.join(" ")).toContain("Vetta");
	});

	it("blocks a shallow experiment record instead of treating keywords as real usage", async () => {
		const directory = await makeDirectory();
		const articlePath = join(directory, "article.md");
		const evidencePath = join(directory, "evidence.json");
		await writeFile(
			articlePath,
			`<!-- vetta-blog: article -->\n# Vetta hook 复现记录\n\n## 我运行了什么\n\n我在 Vetta 中测试了 Skill hook，观察到反馈。https://github.com/openvetta/open-vetta\n\n## 取舍与边界\n\n局限是需要手动复核权限。\n\n## 下一步验证\n\n阅读源码后重跑。`,
			"utf8",
		);
		await writeFile(
			evidencePath,
			JSON.stringify({
				claims: [
					{
						id: "C1",
						importance: "high",
						status: "verified",
						counterevidence_checked: true,
						evidence_ids: ["S1"],
					},
					{ id: "C2", status: "verified", evidence_ids: ["S1"] },
					{ id: "C3", status: "verified", evidence_ids: ["S1"] },
				],
				sources: [
					{
						id: "S1",
						kind: "first_party_code",
						url: "https://github.com/openvetta/open-vetta",
						accessed_at: "2026-08-29",
						supports: ["C1", "C2", "C3"],
					},
				],
				experiments: [{ id: "E1", date: "2026-08-29", observed: "hook 返回反馈", result: "pass" }],
				revision_log: [{ issue: "缺少步骤", change: "待补", rechecked_claim_ids: [] }],
			}),
			"utf8",
		);
		await writeFile(join(directory, "test.log"), "feedback", "utf8");
		const result = validateArticle(articlePath, { evidencePath });
		expect(result.verdict).toBe("BLOCK");
		expect(result.errors.join(" ")).toContain("experiments");
	});

	it("blocks an otherwise strong article when the visual evidence is missing", async () => {
		const directory = await makeDirectory();
		const articlePath = join(directory, "article.md");
		const evidencePath = join(directory, "evidence.json");
		await writeFile(
			articlePath,
			`<!-- vetta-blog: article -->\n# Vetta 本地边界\n\n<!-- claim:C1 -->我测试了 Vetta Skill hook。https://github.com/openvetta/open-vetta\n\n## 运行记录\n\n## 取舍与限制\n\n## 下一步验证\n\n继续阅读源码。`,
			"utf8",
		);
		await writeFile(
			evidencePath,
			JSON.stringify({
				claims: [
					{
						id: "C1",
						importance: "high",
						status: "verified",
						counterevidence_checked: true,
						evidence_ids: ["S1"],
					},
					{ id: "C2", status: "verified", evidence_ids: ["S1"] },
					{ id: "C3", status: "verified", evidence_ids: ["S1"] },
				],
				sources: [
					{
						id: "S1",
						kind: "first_party_code",
						url: "https://github.com/openvetta/open-vetta",
						accessed_at: "2026-08-29",
						supports: ["C1", "C2", "C3"],
					},
				],
				experiments: [
					{
						id: "E1",
						date: "2026-08-29",
						environment: "Windows 11",
						input: "fixture",
						steps: ["run"],
						observed: "反馈",
						result: "pass",
						retries: 0,
						claim_ids: ["C1"],
						artifact_paths: ["test.log"],
					},
				],
				revision_log: [{ issue: "初稿", change: "补充复核", rechecked_claim_ids: ["C1"] }],
			}),
			"utf8",
		);
		const result = validateArticle(articlePath, { evidencePath });
		expect(result.verdict).toBe("BLOCK");
		expect(result.errors.join(" ")).toContain("visual-review.json");
	});
});

async function makeDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "vetta-blog-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

function pngHeader(width: number, height: number): Buffer {
	const bytes = Buffer.alloc(24);
	bytes.writeUInt32BE(0x89504e47, 0);
	bytes.writeUInt32BE(0x0d0a1a0a, 4);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}
