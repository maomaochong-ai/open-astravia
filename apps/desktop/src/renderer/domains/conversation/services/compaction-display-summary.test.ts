// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toCompactionDisplaySummary } from "./compaction-display-summary";

/**
 * 压缩卡显示文本清洗的回归测试。
 *
 * 背景：持久化的 summary 曾把机器工作状态块拼在叙述末尾（写端已修正），但历史记录带着
 * 污染内容落盘。压缩卡原样透传该字段给 Markdown 渲染器，展开后末尾就是一堵转义 JSON 墙。
 * 读端必须剥离，且只做纯字符串清洗、不改写任何持久化数据。
 */

/** 复现实测记录里的形态：叙述 + ~6KB 转义 JSON 工作状态块 + 孤尾闭合标签。 */
const POLLUTED = [
	"## Primary Goal",
	"Fix Astravia desktop app's conversation-switching scroll behavior (#7)",
	"",
	"## Files and Code Context",
	"- `useMessageFeedScrollModel.ts` — THE core file",
	"",
	"<runtime-work-state>",
	'{"plan":{"status":"none","completed":0,"total":0},"todos":[],"backgroundTasks":[{"id":"b119","command":"cd ~/repo && grep -c \\"console\\" file.ts","status":"completed","outputFile":"/var/folders/rw/astravia-task-b119.log","exitCode":0}]}',
	"</runtime-work-state>",
	"</summary>",
].join("\n");

describe("toCompactionDisplaySummary", () => {
	it("剥离机器工作状态块与孤尾闭合标签", () => {
		const display = toCompactionDisplaySummary(POLLUTED);

		expect(display).not.toContain("<runtime-work-state>");
		expect(display).not.toContain("backgroundTasks");
		expect(display).not.toContain("/var/folders/");
		expect(display).not.toContain("</summary>");
		expect(display).not.toContain("b119");
	});

	it("人读叙述完整保留", () => {
		const display = toCompactionDisplaySummary(POLLUTED);

		expect(display).toContain("## Primary Goal");
		expect(display).toContain("Fix Astravia desktop app's conversation-switching scroll behavior (#7)");
		expect(display).toContain("## Files and Code Context");
		expect(display).toContain("useMessageFeedScrollModel.ts");
	});

	it("干净摘要原样返回（不引入多余空行或改动）", () => {
		const clean = "## Primary Goal\n- 保留原有目标\n\n## Pending Tasks\n- [ ] 待办";
		expect(toCompactionDisplaySummary(clean)).toBe(clean);
	});

	it("多个工作状态块（历史叠加）全部清除", () => {
		const doubled = `叙述甲\n\n<runtime-work-state>\n{"a":1}\n</runtime-work-state>\n\n叙述乙\n\n<runtime-work-state>\n{"b":2}\n</runtime-work-state>`;
		const display = toCompactionDisplaySummary(doubled);

		expect(display).not.toContain("runtime-work-state");
		expect(display).toContain("叙述甲");
		expect(display).toContain("叙述乙");
	});

	it("未闭合的工作状态块也清掉（截断写入的兜底）", () => {
		const truncated = '叙述\n\n<runtime-work-state>\n{"plan":{"status":"active"';
		expect(toCompactionDisplaySummary(truncated)).not.toContain("runtime-work-state");
		expect(toCompactionDisplaySummary(truncated)).toBe("叙述");
	});

	it("清除后不残留连续空行", () => {
		const display = toCompactionDisplaySummary(POLLUTED);
		expect(display).not.toMatch(/\n{3,}/);
	});

	it("空与纯机器状态输入不抛错", () => {
		expect(toCompactionDisplaySummary("")).toBe("");
		expect(toCompactionDisplaySummary("<runtime-work-state>\n{}\n</runtime-work-state>")).toBe("");
	});
});
