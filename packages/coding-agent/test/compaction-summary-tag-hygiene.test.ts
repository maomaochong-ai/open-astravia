import { describe, expect, it } from "vitest";
import { extractSummaryFromResponse } from "../src/compaction/compaction.js";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../src/model-context/index.js";

/**
 * 摘要提取的标签卫生回归测试。
 *
 * 背景：提取器此前只在正则匹配到完整 `<summary>...</summary>` 对时才剥标签，匹配失败就
 * 原样返回全文。模型偶尔会把投影里的闭合标签复读出来（输入里就有 `<summary>` 包裹的
 * 上一次摘要），于是持久化的 summary 以一个 `</summary>` 结尾，而投影又会追加
 * COMPACTION_SUMMARY_SUFFIX —— 模型侧看到 `</summary>\n</summary>`，UI 侧渲染出悬挂标签。
 */

describe("extractSummaryFromResponse 标签卫生", () => {
	it("完整配对：提取标签之间的内容并丢弃标签本身", () => {
		const extracted = extractSummaryFromResponse(
			"<analysis>草稿</analysis>\n<summary>\n## Primary Goal\n做某事\n</summary>",
		);
		expect(extracted).toBe("## Primary Goal\n做某事");
		expect(extracted).not.toContain("<summary>");
		expect(extracted).not.toContain("</summary>");
		expect(extracted).not.toContain("草稿");
	});

	it("孤尾闭合标签：清掉残留标记，且不退回原文", () => {
		// 复现实测记录里的形态：叙述正常，但结尾多一个从投影抄来的闭合标签。
		const extracted = extractSummaryFromResponse("## Primary Goal\n做某事\n</summary>");
		expect(extracted).toBe("## Primary Goal\n做某事");
		expect(extracted).not.toContain("</summary>");
	});

	it("只有闭合标签：不把标签当兜底内容返回", () => {
		expect(extractSummaryFromResponse("</summary>")).not.toContain("summary");
		expect(extractSummaryFromResponse("  </summary>  \n")).not.toContain("summary");
	});

	it("无标签文本：原样保留（向后兼容）", () => {
		const plain = "## Primary Goal\n- 保留原有目标";
		expect(extractSummaryFromResponse(plain)).toBe(plain);
	});

	it("投影不会再产出重复闭合标签", () => {
		// 旧 bug 的端到端形态：summary 自带闭合标签 + 投影再追加一个。
		const summary = extractSummaryFromResponse("## Primary Goal\n做某事\n</summary>");
		const projected = COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX;
		const closings = projected.match(/<\/summary>/g) ?? [];
		expect(closings).toHaveLength(1);
		expect(projected.endsWith("</summary>")).toBe(true);
	});

	it("叙述里出现字面 <summary> 时，提取结果不含悬挂标记", () => {
		// 标签协议本身无法区分「叙述里提到的 <summary>」和「协议开标签」——前者会被当作开标签。
		// 这里只钉住真正重要的不变量：任何情况下提取结果都不带悬挂标记。
		const extracted = extractSummaryFromResponse("说明：输出应包裹在 <summary> 标签内\n</summary>");
		expect(extracted).not.toContain("<summary>");
		expect(extracted).not.toContain("</summary>");
		expect(extracted.length).toBeGreaterThan(0);
	});
});
