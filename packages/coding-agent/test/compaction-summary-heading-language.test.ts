import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, Context, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { generateSummary } from "../src/compaction/compaction.js";

/**
 * 压缩摘要的小节标题必须跟随会话语言。
 *
 * 背景：提示词给了「整篇摘要用会话语言」的硬约束，但格式模板里的 `## Primary Goal`、
 * `## Key Constraints & Preferences` 是英文字面量，模型照抄模板 → 中文摘要顶着英文标题，
 * 用户读到的是一份中英混排的文档。这里钉住「标题也要翻译」这条指令出现在两类摘要请求里，
 * 避免以后改模板时把这句话弄丢。
 */

const MODEL = { id: "test-model", provider: "test", api: "openai-completions" } as unknown as Model<Api>;

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

/** 把真正发给模型的上下文拼成字符串，只关心指令原文是否出现。 */
function captureInstructions(captured: Context[]): typeof import("@astravia/ai").completeSimple {
	return async (_model: Model<Api>, context: Context) => {
		captured.push(context);
		return {
			role: "assistant",
			// 长度须 ≥20 且含字母数字（isDegradedCompactionSummary 的质量门）
			content: [{ type: "text" as const, text: "## 主要目标\n- 压缩摘要标题语言回归测试的第 1 轮对话内容。" }],
			timestamp: Date.now(),
			stopReason: "stop",
		} as unknown as AssistantMessage;
	};
}

function instructionText(contexts: Context[]): string {
	expect(contexts.length).toBeGreaterThan(0);
	return JSON.stringify(contexts);
}

describe("压缩摘要的小节标题语言", () => {
	it("首次压缩：要求把格式模板里的英文标题翻成会话语言", async () => {
		const captured: Context[] = [];
		await generateSummary(
			[userMessage("帮我修一下这个 bug")],
			MODEL,
			36000,
			"test-key",
			undefined,
			undefined,
			undefined,
			{ completion: captureInstructions(captured) },
		);

		const instructions = instructionText(captured);
		expect(instructions).toContain("Headings follow the same language");
		expect(instructions).toContain("translate them into that language");
	});

	it("增量压缩：同样要求标题跟随语言，并改写上一版留下的异语言标题", async () => {
		const captured: Context[] = [];
		await generateSummary(
			[userMessage("继续")],
			MODEL,
			36000,
			"test-key",
			undefined,
			undefined,
			"## Primary Goal\n- 旧摘要",
			{ completion: captureInstructions(captured) },
		);

		const instructions = instructionText(captured);
		expect(instructions).toContain("Headings follow the same language");
		expect(instructions).toContain("Rewrite a heading that the previousSummary left in another language");
	});
});
