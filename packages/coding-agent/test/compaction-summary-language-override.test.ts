import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, Context, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { type CompactionPreparation, compact, generateSummary } from "../src/compaction/compaction.js";
import { DEFAULT_COMPACTION_SETTINGS, type SummaryLanguage } from "../src/compaction/contracts.js";
import { createFileOps } from "../src/compaction/summary-support.js";

/**
 * 压缩摘要的语言来源：界面语言优先，缺省才跟随会话语言。
 *
 * 背景：摘要卡摆在界面上给人读，但历史行为是「跟随会话语言」——中文界面 + 英文对话会得到
 * 一份英文摘要，读起来是混语言。宿主可以把界面语言经 `CompactionSettings.summaryLanguage`
 * 传进来，覆盖这条默认规则；没传时保持旧行为，避免改变非桌面宿主的输出。
 */

const MODEL = { id: "test-model", provider: "test", api: "openai-completions" } as unknown as Model<Api>;

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

function captureContexts(captured: Context[]): typeof import("@astravia/ai").completeSimple {
	return async (_model: Model<Api>, context: Context) => {
		captured.push(context);
		return {
			role: "assistant",
			// 长度须 ≥20 且含字母数字（isDegradedCompactionSummary 的质量门）
			content: [{ type: "text" as const, text: "## 主要目标\n- 摘要语言回归测试的正文内容。" }],
			timestamp: Date.now(),
			stopReason: "stop",
		} as unknown as AssistantMessage;
	};
}

/** 只拼正文文本：JSON.stringify 会转义引号，断言标题例子时读不出来。 */
function instructions(captured: Context[]): string {
	expect(captured.length).toBeGreaterThan(0);
	const text = captured
		.flatMap((context) => context.messages)
		.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n");
	expect(text).not.toBe("");
	return text;
}

function preparation(settings: Partial<typeof DEFAULT_COMPACTION_SETTINGS> = {}): CompactionPreparation {
	return {
		firstKeptEntryId: "test-entry",
		messagesToSummarize: [userMessage("请帮我修一个 bug")],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 100,
		fileOps: createFileOps(),
		pathEntries: [],
		prevCompactionIndex: -1,
		settings: { ...DEFAULT_COMPACTION_SETTINGS, ...settings },
	};
}

describe("压缩摘要的语言来源", () => {
	it("未指定界面语言时沿用「跟随会话语言」", async () => {
		const captured: Context[] = [];
		await generateSummary(
			[userMessage("帮我看看这个 bug")],
			MODEL,
			36000,
			"test-key",
			undefined,
			undefined,
			undefined,
			{
				completion: captureContexts(captured),
			},
		);

		const prompt = instructions(captured);
		expect(prompt).toContain("same language as the user's messages in the conversation");
		expect(prompt).not.toContain("the language the app interface is in");
	});

	it("界面语言为中文时，整篇摘要按中文写，不再跟随会话语言", async () => {
		const captured: Context[] = [];
		await generateSummary(
			[userMessage("please fix this bug")],
			MODEL,
			36000,
			"test-key",
			undefined,
			undefined,
			undefined,
			{
				completion: captureContexts(captured),
				summaryLanguage: "zh",
			},
		);

		const prompt = instructions(captured);
		expect(prompt).toContain("Simplified Chinese");
		expect(prompt).toContain("the language the app interface is in");
		expect(prompt).toContain("translate them into Simplified Chinese");
		// 旧规则必须被替换，不能两份语言指令并存
		expect(prompt).not.toContain("same language as the user's messages in the conversation");
	});

	it("界面语言为英文时按英文写", async () => {
		const captured: Context[] = [];
		await generateSummary(
			[userMessage("帮我看看这个 bug")],
			MODEL,
			36000,
			"test-key",
			undefined,
			undefined,
			undefined,
			{
				completion: captureContexts(captured),
				summaryLanguage: "en",
			},
		);

		const prompt = instructions(captured);
		expect(prompt).toContain("the language the app interface is in");
		// 例子方向跟着目标语言走：英文摘要不该拿「翻成中文」当例子
		expect(prompt).toContain('"## 主要目标" → "## Primary Goal"');
		expect(prompt).not.toContain("same language as the user's messages in the conversation");
	});

	it("增量摘要把上一版摘要的内容一并翻成界面语言", async () => {
		const captured: Context[] = [];
		await generateSummary(
			[userMessage("continue")],
			MODEL,
			36000,
			"test-key",
			undefined,
			undefined,
			"## Primary Goal\n- previous English summary",
			{ completion: captureContexts(captured), summaryLanguage: "zh" },
		);

		const prompt = instructions(captured);
		expect(prompt).toContain("translate its content into Simplified Chinese");
		expect(prompt).toContain("Rewrite a heading that the previousSummary left in another language");
	});

	it("split turn 的轮前缀摘要同样跟随界面语言", async () => {
		const captured: Context[] = [];
		const splitPreparation: CompactionPreparation = {
			...preparation({ summaryLanguage: "zh" }),
			isSplitTurn: true,
			messagesToSummarize: [userMessage("较早的对话")],
			turnPrefixMessages: [userMessage("这一轮被切开的前半段")],
		};
		await compact(splitPreparation, MODEL, "test-key", undefined, undefined, {
			completion: captureContexts(captured),
			summaryLanguage: "zh" satisfies SummaryLanguage,
		});

		const prompt = instructions(captured);
		expect(prompt).toContain("## Original Request");
		expect(prompt).toContain("translate them into Simplified Chinese");
		expect(prompt).not.toContain("same language as the user's messages in the conversation");
	});
});
