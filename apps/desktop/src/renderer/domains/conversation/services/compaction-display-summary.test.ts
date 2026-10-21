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

/**
 * 摘要小节标题的语言。
 *
 * 背景：模板给模型的是 `## Primary Goal` 这类英文字面量，模型照抄 → 中文摘要顶着英文标题。
 * 提示词只能约束新摘要，历史记录里已经落盘的是英文标题，所以读端按当前界面语言再映射一次。
 */
describe("localizeCompactionHeadings", () => {
	const zh: Record<string, string> = {
		primaryGoal: "主要目标",
		keyConstraints: "关键约束与偏好",
		currentState: "工作当前状态",
		completed: "已完成",
		filesAndCode: "文件与代码上下文",
		pendingTasks: "待办任务",
		nextSteps: "后续步骤",
	};
	const resolveZh = (key: string) => zh[key];

	it("模板标题跟随界面语言，正文不动", () => {
		const display = toCompactionDisplaySummary(POLLUTED, resolveZh);

		expect(display).toContain("## 主要目标");
		expect(display).toContain("## 文件与代码上下文");
		expect(display).toContain("Fix Astravia desktop app's conversation-switching scroll behavior (#7)");
		expect(display).not.toContain("## Primary Goal");
	});

	it("三级标题同样映射，层级不变", () => {
		const display = toCompactionDisplaySummary("## Current State of Work\n### Completed\n- 做完了", resolveZh);

		expect(display).toBe("## 工作当前状态\n### 已完成\n- 做完了");
	});

	it("英文界面取到原文时保持不变", () => {
		const clean = "## Primary Goal\n- 保留原有目标";
		expect(toCompactionDisplaySummary(clean, () => undefined)).toBe(clean);
	});

	it("模型自己写的中文标题不被二次改写", () => {
		const clean = "## 主要目标\n- 保留原有目标";
		expect(toCompactionDisplaySummary(clean, resolveZh)).toBe(clean);
	});

	it("代码围栏里的同名标题不当成小节标题", () => {
		const text = ["## 待办任务", "```md", "## Primary Goal", "```", "## Next Steps", "1. 收尾"].join("\n");
		const display = toCompactionDisplaySummary(text, resolveZh);

		expect(display).toContain("```md\n## Primary Goal\n```");
		expect(display).toContain("## 后续步骤");
	});

	it("正文行里的同名词不作替换", () => {
		const clean = "## 主要目标\n把 `Completed` 搬到下一节";
		expect(toCompactionDisplaySummary(clean, resolveZh)).toBe(clean);
	});
});
