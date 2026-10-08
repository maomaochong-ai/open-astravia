import type { AgentMessage } from "@astravia/agent-core";
import { describe, expect, it } from "vitest";
import {
	createRecallTool,
	RECALL_TOOL_DESCRIPTION,
	type RecallEntry,
	rankRecallEntries,
} from "../src/features/recall/tool/recall-tool.js";

/**
 * recall 工具（读回被压缩的历史）的回归测试。
 *
 * 背景：会话文档在压缩后完整保留原始条目，但模型可见视图只剩「摘要 + 保留尾」
 * ——摘要没写到的细节对模型即失明。recall 经宿主注入的 readEntries 提供词法
 * AND 搜索 + 分页读回，压缩从「单向门」变为「可逆边界」。
 */

const ENTRIES: readonly RecallEntry[] = [
	{ entryId: "e1", role: "user", text: "帮我重构 auth 模块的配置层" },
	{ entryId: "e2", role: "toolResult", text: "src/auth/config.ts: 120 lines, exports loadConfig" },
	{ entryId: "e3", role: "assistant", text: "已读取配置层，下一步迁移数据库连接" },
	{ entryId: "e4", role: "toolResult", text: "bash: psql -c 'SELECT 1' → ok" },
	{ entryId: "e5", role: "user", text: "配置层先不动，直接看数据库" },
];

describe("rankRecallEntries（词法 AND + 排序）", () => {
	it("AND 语义：全部词命中才入选", () => {
		const ranked = rankRecallEntries(ENTRIES, "auth 数据库");
		// 无任何一条同时含 auth 与 数据库 → 空集（AND 的排他性证明）
		expect(ranked).toHaveLength(0);
		const mixed = rankRecallEntries(ENTRIES, "auth 模块");
		// 中英混排 AND：e1（auth + 模块）唯一命中；e2 有 auth 无「模块」
		expect(mixed.map((item) => item.entry.entryId)).toEqual(["e1"]);
	});

	it("大小写不敏感；CJK 按字面匹配", () => {
		const ranked = rankRecallEntries(ENTRIES, "psql");
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.entry.entryId).toBe("e4");
		const cjk = rankRecallEntries(ENTRIES, "数据库");
		expect(cjk.map((item) => item.entry.entryId)).toEqual(["e3", "e5"]);
	});

	it("排序：命中词数优先，其次总频次", () => {
		const ranked = rankRecallEntries(ENTRIES, "配置");
		// e1/e3/e5 各含「配置」一次——同词数按原文顺序稳定
		expect(ranked.map((item) => item.entry.entryId)).toEqual(["e1", "e3", "e5"]);
	});

	it("空 query 或无命中返回空", () => {
		expect(rankRecallEntries(ENTRIES, "   ")).toHaveLength(0);
		expect(rankRecallEntries(ENTRIES, "不存在的词xyz")).toHaveLength(0);
	});
});

describe("createRecallTool execute", () => {
	it("返回带 entryId/角色的结果与分页信息；超长文本截断有提示", async () => {
		const longEntry: RecallEntry = {
			entryId: "big",
			role: "toolResult",
			text: "x".repeat(3000),
		};
		const tool = createRecallTool({
			readEntries: () => [longEntry, ...ENTRIES],
		});
		const result = await tool.execute({
			sessionId: "s1",
			turnId: "t1",
			toolCallId: "c1",
			input: { query: "xxxx" },
			signal: new AbortController().signal,
		});
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain("entryId=big");
		expect(text).toContain("[…truncated");
		expect(text).toContain("1 message(s) in the full history match");
	});

	it("分页：offset 跳过、footer 提示剩余", async () => {
		const tool = createRecallTool({ readEntries: () => ENTRIES });
		const page1 = await tool.execute({
			sessionId: "s1",
			turnId: "t1",
			toolCallId: "c1",
			input: { query: "配置", limit: 2 },
			signal: new AbortController().signal,
		});
		const text1 = page1.content[0]?.type === "text" ? page1.content[0].text : "";
		expect(text1).toContain("3 message(s) in the full history match");
		expect(text1).toContain("showing 2");
		expect(text1).toContain("1 more match(es)");
		const page2 = await tool.execute({
			sessionId: "s1",
			turnId: "t1",
			toolCallId: "c1",
			input: { query: "配置", limit: 2, offset: 2 },
			signal: new AbortController().signal,
		});
		const text2 = page2.content[0]?.type === "text" ? page2.content[0].text : "";
		expect(text2).toContain("entryId=e5");
		expect(text2).not.toContain("more match(es)");
	});

	it("空结果给出「该试什么」的行动指引，而非沉默", async () => {
		const tool = createRecallTool({ readEntries: () => ENTRIES });
		const result = await tool.execute({
			sessionId: "s1",
			turnId: "t1",
			toolCallId: "c1",
			input: { query: "不存在的词xyz" },
			signal: new AbortController().signal,
		});
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain("Try");
		expect(text).toContain("literal AND search");
	});

	it("readEntries 支持 async（宿主异步读取通道）且收到 sessionId", async () => {
		const seen: string[] = [];
		const tool = createRecallTool({
			readEntries: async (sessionId) => {
				seen.push(sessionId);
				return ENTRIES;
			},
		});
		await tool.execute({
			sessionId: "session-42",
			turnId: "t1",
			toolCallId: "c1",
			input: { query: "psql" },
			signal: new AbortController().signal,
		});
		expect(seen).toEqual(["session-42"]);
	});

	it("工具描述写明 AND 语义与 CJK 字面匹配（PI ADR 0300 同款契约）", () => {
		expect(RECALL_TOOL_DESCRIPTION).toContain("EVERY term must appear");
		expect(RECALL_TOOL_DESCRIPTION).toContain("CJK characters match literally");
		expect(RECALL_TOOL_DESCRIPTION).toContain("compacted away");
	});
});

// AgentMessage 类型仅用于保持与仓库测试文件一致的导入形态。
export type { AgentMessage };
