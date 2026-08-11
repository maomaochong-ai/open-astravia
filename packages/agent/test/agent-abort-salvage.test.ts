import { type AssistantMessage, LanguageModelStream } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../src/engine/run-agent-turn.js";
import type { AgentTurnRequest } from "../src/engine/types.js";

/**
 * 中断挽救（ADR-0060 连带修复）：abort 发生在模型流中途时，provider 会在同一
 * signal 上收尾并以 stopReason=aborted 的部分 assistant 消息 resolve result。
 * 引擎必须在宽限期内把它取回、放进 run 结果的 messages —— 否则已流出的内容
 * 既不发 assistant_message 事件也不落盘，UI 上先显示后被历史重放吞掉。
 */
describe("runAgentTurn abort salvage", () => {
	it("abort 中途取回 stopReason=aborted 的部分回复并计入 messages", async () => {
		const partial = abortedAssistant("部分回复");
		const stream = new LanguageModelStream();
		const controller = new AbortController();

		const run = runAgentTurn({
			messages: [{ role: "user", content: "start", timestamp: 1 }],
			resolveModelCall: async () => ({
				callId: "call-1",
				snapshotId: "snapshot-1",
				response: { events: stream, result: stream.result() },
			}),
			resolveTools: async () => [],
			toolPolicy: { authorize: async () => undefined },
			limits: { maxModelCalls: 10, maxToolCalls: 10, maxRecoveryAttempts: 2, checkpointTimeoutMs: 50 },
			signal: controller.signal,
			observer: (event) => {
				if (event.type === "model_event" && event.event.type === "start") {
					// 模拟用户中断：abort 后 provider 才交回部分消息（真实时序）。
					controller.abort("user interrupted");
					setTimeout(() => {
						stream.push({ type: "done", reason: "aborted", message: partial } as never);
					}, 10);
				}
			},
		} satisfies AgentTurnRequest);

		stream.push({ type: "start", partial } as never);

		const result = await run.result;
		expect(result.status).toBe("aborted");
		const salvaged = result.messages.find((message) => message.role === "assistant");
		expect(salvaged).toBeDefined();
		expect(salvaged && "stopReason" in salvaged ? salvaged.stopReason : undefined).toBe("aborted");
	});

	it("provider abort 时直接 reject（生产路径）：从事件流累积的 partial 挽救部分回复", async () => {
		// 模拟真实 adapter：reducer 持续 mutate 同一个 partial 对象，abort 时 stream.fail()。
		const partial = abortedAssistant("");
		(partial as { stopReason: string }).stopReason = "stop";
		const stream = new LanguageModelStream();
		const controller = new AbortController();

		const run = runAgentTurn({
			messages: [{ role: "user", content: "start", timestamp: 1 }],
			resolveModelCall: async () => ({
				callId: "call-1",
				snapshotId: "snapshot-1",
				response: { events: stream, result: stream.result() },
			}),
			resolveTools: async () => [],
			toolPolicy: { authorize: async () => undefined },
			limits: { maxModelCalls: 10, maxToolCalls: 10, maxRecoveryAttempts: 2, checkpointTimeoutMs: 50 },
			signal: controller.signal,
			observer: (event) => {
				if (event.type === "model_event" && event.event.type === "text_delta") {
					controller.abort("user interrupted");
					// provider 在同一 signal 上中止请求并 reject result——不交回消息。
					setTimeout(() => stream.fail(new Error("aborted by provider")), 0);
				}
			},
		} satisfies AgentTurnRequest);

		stream.push({ type: "start", partial } as never);
		partial.content.push({ type: "text", text: "部分回复" });
		stream.push({ type: "text_delta", partial, contentIndex: 0, delta: "部分回复" } as never);

		const result = await run.result;
		expect(result.status).toBe("aborted");
		const salvaged = result.messages.find((message) => message.role === "assistant");
		expect(salvaged).toBeDefined();
		expect(salvaged && "stopReason" in salvaged ? salvaged.stopReason : undefined).toBe("aborted");
		const text =
			salvaged && Array.isArray(salvaged.content)
				? salvaged.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("")
				: "";
		expect(text).toBe("部分回复");
	});

	it("provider 宽限期内不 resolve 时按原语义终止（不产生 assistant 消息）", async () => {
		const stream = new LanguageModelStream();
		const controller = new AbortController();

		const run = runAgentTurn({
			messages: [{ role: "user", content: "start", timestamp: 1 }],
			resolveModelCall: async () => ({
				callId: "call-1",
				snapshotId: "snapshot-1",
				response: { events: stream, result: stream.result() },
			}),
			resolveTools: async () => [],
			toolPolicy: { authorize: async () => undefined },
			limits: { maxModelCalls: 10, maxToolCalls: 10, maxRecoveryAttempts: 2, checkpointTimeoutMs: 50 },
			signal: controller.signal,
			observer: (event) => {
				if (event.type === "model_event" && event.event.type === "start") {
					controller.abort("user interrupted");
					// provider 永不收尾：宽限超时后放弃挽救。
				}
			},
		} satisfies AgentTurnRequest);

		stream.push({ type: "start", partial: abortedAssistant("") } as never);

		const result = await run.result;
		expect(result.status).toBe("aborted");
		expect(result.messages.some((message) => message.role === "assistant")).toBe(false);
	}, 10_000);
});

function abortedAssistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "aborted",
		timestamp: 1,
	} as AssistantMessage;
}
