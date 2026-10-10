import { describe, expect, it } from "vitest";
import type { CompactionResult } from "../src/compaction/index.js";
import { createCodingAgentCompactionRecord } from "../src/compaction/runtime/compaction-record-factory.js";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../src/model-context/index.js";

/**
 * 压缩记录的「双表示」分离回归测试。
 *
 * 背景：`summary` 与 `summaryMessage` 服务两个不同消费者，却曾被写成同一个字符串 ——
 * `appendCompactionWorkState` 把在飞 todo / 后台任务（实测约 6KB 转义 JSON）拼进 `summary`，
 * 于是：
 *   1) UI 压缩卡原样透传 `summary` 给 Markdown，展开后末尾是一堵 JSON 墙；
 *   2) 下次压缩把这段机器状态当作 previousSummary 喂回给模型。
 *
 * 契约（本组用例钉住）：
 *   - `summary` 只能是人读的叙述；
 *   - 工作状态只进 `summaryMessage`，模型的工作状态恢复能力不变。
 */

const NOW = () => 1_700_000_000_000;

const WORK_STATE = {
	todos: [{ id: 1, content: "修复压缩摘要乱码", status: "in_progress" as const }],
	backgroundTasks: [
		{
			id: "b119",
			command: "cd /repo && grep -c 'console' useMessageFeedScrollModel.ts",
			status: "completed" as const,
			outputFile: "/var/folders/rw/astravia-task-b119.log",
			exitCode: 0,
		},
	],
};

function result(summary: string): CompactionResult {
	return { summary, firstKeptEntryId: "event-42", tokensBefore: 419_967 };
}

function textOf(record: { summaryMessage?: { content: unknown } }): string {
	const content = record.summaryMessage?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => (typeof item === "object" && item !== null && "text" in item ? String(item.text) : ""))
		.join("");
}

describe("createCodingAgentCompactionRecord 双表示分离", () => {
	it("summary 只含人读叙述，不含机器工作状态", () => {
		const record = createCodingAgentCompactionRecord(result("## Primary Goal\n修复乱码"), "threshold", false, {
			now: NOW,
			readCompactionWorkState: () => WORK_STATE,
		});

		expect(record.summary).toBe("## Primary Goal\n修复乱码");
		expect(record.summary).not.toContain("<runtime-work-state>");
		expect(record.summary).not.toContain("b119");
		expect(record.summary).not.toContain("/var/folders/");
	});

	it("summaryMessage 仍带工作状态：模型恢复在飞任务的能力不变", () => {
		const record = createCodingAgentCompactionRecord(result("## Primary Goal\n修复乱码"), "threshold", false, {
			now: NOW,
			readCompactionWorkState: () => WORK_STATE,
		});

		const text = textOf(record);
		expect(text.startsWith(COMPACTION_SUMMARY_PREFIX)).toBe(true);
		expect(text.endsWith(COMPACTION_SUMMARY_SUFFIX)).toBe(true);
		expect(text).toContain("<runtime-work-state>");
		expect(text).toContain("修复压缩摘要乱码");
		expect(text).toContain("b119");
	});

	it("投影后的模型消息里 <summary> 开合各一次（不出现重复闭合标签）", () => {
		const record = createCodingAgentCompactionRecord(result("## Primary Goal\n修复乱码"), "threshold", false, {
			now: NOW,
			readCompactionWorkState: () => WORK_STATE,
		});

		const text = textOf(record);
		expect(text.match(/<summary>/g)).toHaveLength(1);
		expect(text.match(/<\/summary>/g)).toHaveLength(1);
	});

	it("无工作状态时 summaryMessage 就是干净叙述，summary 不受影响", () => {
		const record = createCodingAgentCompactionRecord(result("## Primary Goal\n无在飞任务"), "threshold", false, {
			now: NOW,
			readCompactionWorkState: undefined,
		});

		expect(record.summary).toBe("## Primary Goal\n无在飞任务");
		const text = textOf(record);
		expect(text).not.toContain("<runtime-work-state>");
		expect(text).toContain("## Primary Goal\n无在飞任务");
	});

	it("叙述自带残留 <summary> 标签时，不会污染 summary（提取器负责清，这里钉住透传不改写）", () => {
		// 记录工厂不做二次清洗：它只负责不主动注入机器状态。
		// 残留标签由 extractSummaryFromResponse（新记录）与读端清洗（旧记录）分别拦。
		const record = createCodingAgentCompactionRecord(result("## Primary Goal\n修复乱码"), "threshold", false, {
			now: NOW,
			readCompactionWorkState: () => WORK_STATE,
		});

		expect(record.summary).not.toContain("<runtime-work-state>");
		expect(record.summary).not.toContain("</summary>");
	});

	it("其余字段原样透传", () => {
		const record = createCodingAgentCompactionRecord(
			{ ...result("## Primary Goal\n带账本"), details: { readFiles: ["a.ts"] } },
			"manual",
			true,
			{ now: NOW, readCompactionWorkState: () => WORK_STATE },
		);

		expect(record.firstKeptEntryId).toBe("event-42");
		expect(record.tokensBefore).toBe(419_967);
		expect(record.details).toEqual({ readFiles: ["a.ts"] });
		expect(record.fromHook).toBe(true);
		expect(record.reason).toBe("manual");
		expect(record.summaryMessage?.timestamp).toBe(NOW());
	});
});
