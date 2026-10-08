import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, Context, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { generateSummary } from "../src/compaction/compaction.js";
import {
	createCompactionSummaryInputCandidates,
	prefilterSummaryCandidates,
} from "../src/compaction/summary-input-degradation.js";

/**
 * 降级链预检的回归测试。
 *
 * 背景：长会话（恰是最需要压缩的场景）的 full 档几乎必然超过摘要模型的输入
 * 窗口。旧流程要把它真正发给 provider、等 input-too-large 报错、再逐档降级
 * 重试——每次空跑都是一次完整的失败请求。预检用与触发判定同源的逐字口径
 * 先估每个档位，超预算的直接跳过。
 */

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

function toolResult(text: string): AgentMessage {
	return {
		role: "toolResult",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

/** 40KB ASCII 输出 → 逐字估算约 10k token。 */
const BIG_OUTPUT = "x".repeat(40 * 1024);

describe("prefilterSummaryCandidates", () => {
	it("不超预算时全部保留（顺序与档位不变）", () => {
		const candidates = createCompactionSummaryInputCandidates([userMessage("短会话")]);
		const filtered = prefilterSummaryCandidates(candidates, 200_000, 8_000);
		expect(filtered.map((candidate) => candidate.level)).toEqual([
			"full",
			"compact-tool-results",
			"essential",
			"recent-three-turns",
		]);
	});

	it("full 档超预算被跳过，compact 档（工具输出截断到 2KB）保留", () => {
		const candidates = createCompactionSummaryInputCandidates([
			userMessage("先跑构建"),
			toolResult(BIG_OUTPUT), // full ≈10k token；compact 截断后 ≈0.5k
		]);
		// 预算 = 20000 - 8000(输出) - 4000(边际) = 8000 → full(≈10k) 超限
		const filtered = prefilterSummaryCandidates(candidates, 20_000, 8_000);
		expect(filtered[0]?.level).toBe("compact-tool-results");
		expect(filtered.some((candidate) => candidate.level === "full")).toBe(false);
	});

	it("全部超限时保留最小档（宁降级不空链）", () => {
		// 10 条 40KB 用户消息（用户文本在 4 个档里都不被截断/省略）：
		// full/compact/essential ≈ 100k、recent-three-turns ≈ 30k，预算 14k 全超
		const messages = Array.from({ length: 10 }, (_, index) => userMessage(`${"u".repeat(40 * 1024)} #${index}`));
		const candidates = createCompactionSummaryInputCandidates(messages);
		const filtered = prefilterSummaryCandidates(candidates, 20_000, 2_000);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.level).toBe("recent-three-turns");
	});

	it("contextWindow 未知（0）时不预检，维持旧行为", () => {
		const candidates = createCompactionSummaryInputCandidates([toolResult(BIG_OUTPUT)]);
		const filtered = prefilterSummaryCandidates(candidates, 0, 8_000);
		expect(filtered).toBe(candidates);
	});
});

describe("generateSummary 预检接线（端到端）", () => {
	function makeModel(contextWindow: number): Model<Api> {
		return { id: "test-model", provider: "test", api: "openai-completions", contextWindow } as unknown as Model<Api>;
	}

	async function summarizeWithCapture(model: Model<Api>): Promise<{ promptTexts: string[] }> {
		const promptTexts: string[] = [];
		const completion = async (_model: Model<Api>, context: Context): Promise<AssistantMessage> => {
			const text = (context.messages[0]?.content as Array<{ type: string; text?: string }>)
				?.filter((block) => block.type === "text")
				.map((block) => block.text ?? "")
				.join("\n");
			promptTexts.push(text ?? "");
			return {
				role: "assistant",
				content: [
					{
						type: "text",
						// 长度 ≥20 且含字母数字（过 isDegradedCompactionSummary 质量门）
						text: "本轮构建与测试输出已完成摘要整理：构建一次通过，测试覆盖主路径与异常路径，工具输出按口径截断纳入账目，正文长度满足大源场景下质量门限的最小要求（八十字符以上）。",
					},
				],
				timestamp: Date.now(),
				stopReason: "stop",
			} as unknown as AssistantMessage;
		};
		await generateSummary(
			[userMessage("先跑构建"), toolResult(BIG_OUTPUT)],
			model,
			36000,
			"test-key",
			undefined,
			undefined,
			undefined,
			{ completion },
		);
		return { promptTexts };
	}

	it("小窗口：首个请求已不含全量工具输出（full 档被预检跳过）", async () => {
		const { promptTexts } = await summarizeWithCapture(makeModel(20_000));
		expect(promptTexts.length).toBeGreaterThanOrEqual(1);
		// full 档会携带 40KB 原文；compact 档截断到 2KB——首请求文本必须远小于 40KB
		expect(promptTexts[0]?.length ?? 0).toBeLessThan(10_000);
	});

	it("大窗口：full 档照常首发（预检不改变正常路径）", async () => {
		const { promptTexts } = await summarizeWithCapture(makeModel(500_000));
		expect(promptTexts.length).toBeGreaterThanOrEqual(1);
		// full 携带 40KB 原文，提示词应显著大于 20KB
		expect(promptTexts[0]?.length ?? 0).toBeGreaterThan(20_000);
	});
});
