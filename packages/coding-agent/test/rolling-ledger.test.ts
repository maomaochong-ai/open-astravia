import type { AgentMessage } from "@astravia/agent-core";
import type { AssistantMessage } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import {
	assembleRollingSummary,
	buildTurnLedgerEntry,
	ROLLING_KEEP_RECENT_TURNS,
	type RollingLedger,
	type TurnLedgerEntry,
} from "../src/compaction/rolling-ledger.js";

/**
 * R2 前置验证（A/B 度量的第一半）：滚动账本的纯函数层。
 *
 * 度量设计（方案 §六 R2 / §三红线 2）：A/B 需要「主动记忆不降级」的可比数据。
 * 本组测试确立 B 轨（滚动式）的**内容下界**：拼装摘要必含逐轮账目与机械账本，
 * 且近区间逐字保留——这是「主动记忆」在测试层的可断言代理（内容在 → 模型
 * 可见；内容不在 → 必然失忆）。真实模型层的 A/B 由宿主接线后跑（R2 交付物
 * 的验证数据节），此处先把可机械验证的部分全钉死。
 */

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

function assistant(text: string, stopReason: "stop" | "aborted" = "stop"): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: 2,
		stopReason,
	} as unknown as AgentMessage;
}

function toolResult(text: string): AgentMessage {
	return { role: "toolResult", content: [{ type: "text", text }], timestamp: 3 } as AgentMessage;
}

function assistantUsage(total: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "…" }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: total },
		timestamp: 4,
		stopReason: "stop",
	} as unknown as AssistantMessage;
}

function entry(turn: number, narrative: string, opts?: Partial<TurnLedgerEntry>): TurnLedgerEntry {
	return {
		turn,
		narrative,
		mechanical: {
			readFiles: opts?.mechanical?.readFiles ?? [],
			modifiedFiles: opts?.mechanical?.modifiedFiles ?? [],
			messageCounts: opts?.mechanical?.messageCounts ?? {},
			estimatedTokens: opts?.mechanical?.estimatedTokens ?? 10,
			generatedAt: `2026-10-08T00:${String(turn).padStart(2, "0")}:00.000Z`,
		},
		...(opts?.revised ? { revised: opts.revised } : {}),
	};
}

describe("buildTurnLedgerEntry（逐轮记账）", () => {
	it("一轮三消息 → 一条账目：叙述 + 机械（计数/token）齐全", () => {
		const turnMessages = [user("跑构建"), assistantUsage(5000), toolResult("build ok")];
		const e = buildTurnLedgerEntry(3, turnMessages, "完成了构建并验证产物", () => new Date("2026-10-08T01:00:00Z"));
		expect(e.turn).toBe(3);
		expect(e.narrative).toContain("构建");
		expect(e.mechanical.messageCounts).toEqual({ user: 1, assistant: 1, toolResult: 1 });
		expect(e.mechanical.estimatedTokens).toBeGreaterThan(0);
	});

	it("中止轮不记账（aborted/异常轮没有可靠事实可记）", () => {
		const aborted = [user("x"), assistant("partial", "aborted")];
		expect(buildTurnLedgerEntry(1, aborted, "n", () => new Date())).toBeUndefined();
	});
});

describe("assembleRollingSummary（拼装式压缩——红线 2 的内容下界）", () => {
	it("拼装必含：压实区间的逐轮叙述 + 机械账本 + 近区间轮次逐字保留", () => {
		const ledger: RollingLedger = {
			entries: [entry(1, "第一轮：初始化项目"), entry(2, "第二轮：修复构建"), entry(3, "第三轮：写测试")],
			compactedUpToTurn: 0,
		};
		const recentTurns = [entry(4, "第四轮：跑全量")];
		const result = assembleRollingSummary(ledger, recentTurns, { compactBudgetTokens: 2000 });
		// 逐轮叙述都在（主动记忆内容下界）
		expect(result.summary).toContain("第一轮");
		expect(result.summary).toContain("第二轮");
		expect(result.summary).toContain("第三轮");
		// 近区间逐字（不压实的近轮）
		expect(result.summary).toContain("第四轮");
		// 账本结构标记
		expect(result.summary).toContain("<rolling-ledger");
		expect(result.keptTurns).toBe(4);
	});

	it("红线 1（数据层）：账目超预算时截断并标注完整历史可召回——不静默丢轮", () => {
		const many = Array.from({ length: 50 }, (_, i) => entry(i + 1, `第${i + 1}轮：做了事情${"详".repeat(40)}`));
		const ledger: RollingLedger = { entries: many, compactedUpToTurn: 0 };
		const result = assembleRollingSummary(ledger, [], { compactBudgetTokens: 600 });
		expect(result.summary).toContain("完整逐轮历史");
		expect(result.summary).toContain("recall");
		// 近轮保留、远轮让位（近优先）
		expect(result.summary).toContain("第50轮");
	});

	it("红线 4（修订冻结）：revised 轮次在拼装中原样保留、优先于叙述合并", () => {
		const ledger: RollingLedger = {
			entries: [
				entry(1, "配置层迁移完成"),
				entry(2, "数据库切换", { revised: "数据库迁移层切换（用户修订：是迁移层不是配置层）" }),
			],
			compactedUpToTurn: 0,
		};
		const result = assembleRollingSummary(ledger, [], { compactBudgetTokens: 4000 });
		expect(result.summary).toContain("[用户修订]");
		// 冻结语义的严格断言：叙述行以修订文本为主体（T2 行不得再以原叙述开头）。
		const t2Line = result.summary.split("\n").find((line) => line.startsWith("- T2 "));
		expect(t2Line).toBeDefined();
		// 叙述位是修订后的文本（narrativeOf 冻结生效）
		expect(t2Line).toContain("是迁移层不是配置层");
		// 原叙述不再出现在 T2 行（被修订替换，不是并存）
		expect(t2Line === "- T2 数据库切换 [用户修订] 数据库迁移层切换（用户修订：是迁移层不是配置层）").toBe(false);
	});

	it("空账本 + 空近区 → 空串（零噪音，不虚构）", () => {
		const result = assembleRollingSummary({ entries: [], compactedUpToTurn: 0 }, [], { compactBudgetTokens: 1000 });
		expect(result.summary).toBe("");
	});

	it("近区间上限（ROLLING_KEEP_RECENT_TURNS）：默认 10 轮不压实", () => {
		expect(ROLLING_KEEP_RECENT_TURNS).toBe(10);
	});
});
