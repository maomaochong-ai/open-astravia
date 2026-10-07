import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, Context, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { generateSummary } from "../src/compaction/compaction.js";

/**
 * 压缩摘要生成的速度参数回归测试。
 *
 * 背景：摘要生成此前以 reasoning:"high" + maxTokens=0.8×reserve（默认 ≈28.8k）调用主模型，
 * 推理模型的思考预算与大输出预算叠加，把一次压缩拖到数十秒。本组用例钉住两个收敛后的参数：
 *   1) maxTokens ≤ min(8000, 0.25×reserve)（轮前缀摘要 ≤ min(4000, 0.25×reserve)）
 *   2) reasoning 固定 "low"（摘要无需高强度推理）
 * 通过注入捕获 options 的 completion 实现，断言真正发给模型的请求参数。
 */

const MODEL = { id: "test-model", provider: "test", api: "openai-completions" } as unknown as Model<Api>;

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

interface CapturedCall {
	readonly maxTokens: number | undefined;
	readonly reasoning: string | undefined;
}

function capturingCompletion(captured: CapturedCall[]): typeof import("@astravia/ai").completeSimple {
	return async (_model: Model<Api>, _context: Context, options?: { maxTokens?: number; reasoning?: string }) => {
		captured.push({ maxTokens: options?.maxTokens, reasoning: options?.reasoning });
		const response = {
			role: "assistant",
			// 长度须 ≥20 且含字母数字（isDegradedCompactionSummary 的质量门）
			content: [
				{
					type: "text" as const,
					text: "## 已完成\n- 第一轮与第二轮对话已完成压缩摘要测试，正文长度满足质量门限要求。",
				},
			],
			timestamp: Date.now(),
			stopReason: "stop",
		} as unknown as AssistantMessage;
		return response;
	};
}

describe("generateSummary 速度参数", () => {
	it("主摘要：maxTokens 收敛到 min(8000, 0.25×reserve)，reasoning 降为 low", async () => {
		const captured: CapturedCall[] = [];
		await generateSummary(
			[userMessage("第一轮"), userMessage("第二轮")],
			MODEL,
			36000, // 默认 reserveTokens：旧实现会给 0.8×36000=28800
			"test-key",
			undefined,
			undefined,
			undefined,
			{ completion: capturingCompletion(captured) },
		);
		expect(captured.length).toBeGreaterThan(0);
		for (const call of captured) {
			// 旧值 28800；新值 min(8000, 9000) = 8000
			expect(call.maxTokens).toBe(8000);
			expect(call.reasoning).toBe("low");
		}
	});

	it("小 reserve 时按比例收缩（0.25×reserve < 8000）", async () => {
		const captured: CapturedCall[] = [];
		await generateSummary(
			[userMessage("内容")],
			MODEL,
			16000, // 0.25×16000 = 4000 < 8000
			"test-key",
			undefined,
			undefined,
			undefined,
			{ completion: capturingCompletion(captured) },
		);
		expect(captured.length).toBeGreaterThan(0);
		for (const call of captured) {
			expect(call.maxTokens).toBe(4000);
		}
	});
});
