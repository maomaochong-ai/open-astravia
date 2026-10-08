import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, AssistantMessageEvent, Context, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { deltaForwardingCompletion, generateSummary } from "../src/compaction/compaction.js";

/**
 * 压缩摘要流式增量（compaction.delta 通路）的回归测试。
 *
 * 背景：摘要生成此前对 UI 完全黑盒——completeSimple 等到终态才返回，压缩期间
 * 用户只能干等。deltaForwardingCompletion 包装 streamSimple：每段 text_delta
 * 到达即回调 onDelta（拼接即全量摘要），返回值与 completeSimple 同构，可直接
 * 注入 completion 位；generateSummary 在 onSummaryDelta 设置且未显式注入
 * completion 时自动切换到该通路。
 */

const MODEL = { id: "test-model", provider: "test", api: "openai-completions" } as unknown as Model<Api>;

/** 最小伪事件流：可异步迭代 + result()。 */
class FakeEventStream implements AsyncIterable<AssistantMessageEvent> {
	constructor(
		private readonly events: AssistantMessageEvent[],
		private readonly resultMessage: AssistantMessage,
	) {}
	async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		for (const event of this.events) yield event;
	}
	result(): Promise<AssistantMessage> {
		return Promise.resolve(this.resultMessage);
	}
}

function textEvent(delta: string, contentIndex = 0): AssistantMessageEvent {
	return {
		type: "text_delta",
		contentIndex,
		delta,
		partial: { role: "assistant", content: [], timestamp: Date.now() } as unknown as AssistantMessage,
	} as AssistantMessageEvent;
}

function doneEvent(message: AssistantMessage): AssistantMessageEvent {
	return { type: "done", reason: "stop", message };
}

describe("deltaForwardingCompletion", () => {
	it("逐段转发 text_delta（保序），thinking/toolcall 事件不打扰，终态返回 result", async () => {
		const received: string[] = [];
		const finalMessage = {
			role: "assistant",
			content: [{ type: "text", text: "全量摘要" }],
			timestamp: Date.now(),
			stopReason: "stop",
		} as unknown as AssistantMessage;
		const events: AssistantMessageEvent[] = [
			{ type: "start", partial: finalMessage } as AssistantMessageEvent,
			textEvent("第一段。"),
			textEvent("第二段。"),
			textEvent("第三段。"),
			{
				type: "thinking_delta",
				contentIndex: 1,
				delta: "思考不应转发",
				partial: finalMessage,
			} as AssistantMessageEvent,
			doneEvent(finalMessage),
		];
		const result = await deltaForwardingCompletion(
			MODEL,
			{ messages: [] } as unknown as Context,
			{ maxTokens: 8000 },
			(delta) => {
				received.push(delta);
			},
			((_model: any, _context: any, options: any) => {
				expect(options?.maxTokens).toBe(8000); // options 原样透传给流式层
				return new FakeEventStream(events, finalMessage);
			}) as any,
		);
		expect(received).toEqual(["第一段。", "第二段。", "第三段。"]);
		expect(result).toBe(finalMessage);
	});

	it("onDelta 可为 async：每段都等待回调完成再继续（保序不竞态）", async () => {
		const order: string[] = [];
		const finalMessage = {
			role: "assistant",
			content: [],
			timestamp: 0,
			stopReason: "stop",
		} as unknown as AssistantMessage;
		await deltaForwardingCompletion(
			MODEL,
			{} as Context,
			undefined,
			async (delta) => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				order.push(delta);
			},
			(() => new FakeEventStream([textEvent("a"), textEvent("b"), doneEvent(finalMessage)], finalMessage)) as any,
		);
		expect(order).toEqual(["a", "b"]);
	});
});

describe("generateSummary 与 onSummaryDelta 的接线", () => {
	it("显式注入的 completion 优先（测试注入不被流式通路抢占）", async () => {
		const completionCalls: number[] = [];
		const completion = async (): Promise<AssistantMessage> => {
			completionCalls.push(1);
			return {
				role: "assistant",
				content: [{ type: "text", text: "显式 completion 的摘要结果，长度满足质量门限的最小要求。" }],
				timestamp: Date.now(),
				stopReason: "stop",
			} as unknown as AssistantMessage;
		};
		const summary = await generateSummary(
			[{ role: "user", content: [{ type: "text", text: "内容" }], timestamp: Date.now() }] as AgentMessage[],
			MODEL,
			36000,
			"key",
			undefined,
			undefined,
			undefined,
			{
				completion,
				onSummaryDelta: () => {
					throw new Error("不应走流式通路");
				},
			},
		);
		expect(completionCalls).toHaveLength(1);
		expect(summary.length).toBeGreaterThan(0);
	});
});
