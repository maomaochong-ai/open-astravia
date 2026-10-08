import type { AgentMessage } from "@astravia/agent-core";
import { describe, expect, it } from "vitest";
import {
	buildMechanicalLedger,
	formatMechanicalLedger,
	LEDGER_MAX_FILES_PER_LIST,
} from "../src/compaction/mechanical-ledger.js";

/**
 * 机械账本（Rolling Compaction R1）的回归测试。
 *
 * 背景：账本先行落位——压缩触发的瞬间机械层毫秒级可出（零 LLM、确定性），
 * 挂在 CompactionEntry.details.ledger。它是「完整账本」记录要求的强化，
 * 也是叙述摘要失败时的降级内容（账本仍在，压缩不空手而归）。
 *
 * 与叙述摘要的一致性约束：文件提取复用 extractFileOpsFromMessage（同源），
 * 账本与摘要里的文件清单不会各说各话——本测试用同款消息验证。
 */

function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

function assistantWithToolCall(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "/w/b.ts" } },
			{ type: "text", text },
		],
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

const FIXED_NOW = () => new Date("2026-10-08T00:00:00.000Z");

describe("buildMechanicalLedger", () => {
	it("空区间：账本为空但不为 undefined（结构恒在）", () => {
		const ledger = buildMechanicalLedger([], [], -1, FIXED_NOW);
		expect(ledger.readFiles).toEqual([]);
		expect(ledger.modifiedFiles).toEqual([]);
		expect(ledger.messageCounts).toEqual({});
		expect(ledger.estimatedTokens).toBe(0);
		expect(ledger.generatedAt).toBe("2026-10-08T00:00:00.000Z");
	});

	it("消息计数与 token 估算（逐字口径）", () => {
		const messages = [userMessage("x".repeat(4000)), assistantWithToolCall("done")];
		const ledger = buildMechanicalLedger(messages, [], -1, FIXED_NOW);
		expect(ledger.messageCounts).toEqual({ user: 1, assistant: 1 });
		// 4000 ASCII = 1000 token（工具调用参数另计）
		expect(ledger.estimatedTokens).toBeGreaterThanOrEqual(1000);
	});

	it("文件清单有序：输出排序确定（跨次一致，投影可 diff）", () => {
		const ledgerA = buildMechanicalLedger([userMessage("a"), assistantWithToolCall("b")], [], -1, FIXED_NOW);
		// 与 compact() 的 computeFileLists 同款排序语义：readFiles/modifiedFiles 均 sort()
		expect([...ledgerA.readFiles]).toEqual([...ledgerA.readFiles].sort());
		expect([...ledgerA.modifiedFiles]).toEqual([...ledgerA.modifiedFiles].sort());
		// 非空清单的确定性：乱序输入 → 有序输出
		const ledgerB = buildMechanicalLedger(
			[
				userMessage("x"),
				{
					role: "assistant",
					content: [
						{ type: "toolCall", id: "c2", name: "read", arguments: { path: "/z/last.ts" } },
						{ type: "toolCall", id: "c3", name: "read", arguments: { path: "/a/first.ts" } },
					],
					timestamp: Date.now(),
				} as unknown as AgentMessage,
			],
			[],
			-1,
			FIXED_NOW,
		);
		const reads = [...ledgerB.readFiles];
		expect(reads.indexOf("/a/first.ts")).toBeLessThan(reads.indexOf("/z/last.ts"));
	});

	it("纯函数：同输入恒同输出（now 注入，无隐式时间）", () => {
		const messages = [userMessage("确定")];
		const a = buildMechanicalLedger(messages, [], -1, FIXED_NOW);
		const b = buildMechanicalLedger(messages, [], -1, FIXED_NOW);
		expect(a).toEqual(b);
	});
});

describe("formatMechanicalLedger（有界性）", () => {
	it("正常规模：文件清单 + 计数全量呈现", () => {
		const ledger = buildMechanicalLedger([userMessage("x"), assistantWithToolCall("y")], [], -1, FIXED_NOW);
		const text = formatMechanicalLedger(ledger);
		expect(text).toContain("<ledger");
		expect(text).toContain('generated-at="2026-10-08T00:00:00.000Z"');
		expect(text).toContain("user:1");
		expect(text).toContain("assistant:1");
	});

	it("超大清单截断到上限并标注（账本有界红线）", () => {
		const ledger = {
			readFiles: Array.from({ length: LEDGER_MAX_FILES_PER_LIST + 40 }, (_, i) => `/r/${i}.ts`),
			modifiedFiles: [],
			messageCounts: { user: 1 },
			estimatedTokens: 10,
			generatedAt: FIXED_NOW().toISOString(),
		};
		const text = formatMechanicalLedger(ledger);
		expect(text).toContain("另有 40 个");
		expect(text).toContain("账本有界截断");
		// 上限内文件仍可见
		expect(text).toContain("/r/0.ts");
		expect(text).toContain(`/r/${LEDGER_MAX_FILES_PER_LIST - 1}.ts`);
		// 超限文件不出现
		expect(text).not.toContain(`/r/${LEDGER_MAX_FILES_PER_LIST}.ts`);
	});

	it("全空账本格式化为空串（投影层零噪音）", () => {
		const ledger = buildMechanicalLedger([], [], -1, FIXED_NOW);
		expect(formatMechanicalLedger(ledger)).toBe("");
	});
});
