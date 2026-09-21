// @vitest-environment jsdom

import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { describe, expect, it } from "vitest";
import { buildMessageHeightEstimates, createMessageItemSizeRecorder } from "./message-height-estimates";

describe("message height estimates", () => {
	it("gives consecutive long replies their own tall estimates instead of a uniform fallback", () => {
		const firstText = Array.from(
			{ length: 120 },
			(_, index) => `第 ${index + 1} 行包含一段需要展示的分析内容。`,
		).join("\n");
		const secondText = Array.from({ length: 95 }, (_, index) => `Result ${index + 1}: detailed explanation`).join(
			"\n",
		);
		const messages = [
			createConversationAgentMessage({
				id: "long-agent-1",
				text: firstText,
				blocks: [{ type: "text", id: "long-text-1", text: firstText }],
			}),
			createConversationAgentMessage({
				id: "long-agent-2",
				text: secondText,
				blocks: [{ type: "text", id: "long-text-2", text: secondText }],
			}),
		];

		const estimates = buildMessageHeightEstimates(messages, "long-conversation");

		expect(estimates[0]).toBeGreaterThan(2_500);
		expect(estimates[1]).toBeGreaterThan(2_000);
		expect(new Set(estimates).size).toBe(2);
	});

	it("keeps a long user request bounded by the visible ten-line collapsed state", () => {
		const longUserText = Array.from({ length: 80 }, (_, index) => `user line ${index}`).join("\n");
		const user = createConversationUserMessage({ id: "long-user", text: longUserText });

		const [estimate] = buildMessageHeightEstimates([user], "collapsed-user-conversation");

		expect(estimate).toBeGreaterThan(200);
		expect(estimate).toBeLessThan(400);
	});

	it("estimates a collapsed tool group from its visible summary instead of hidden tool details", () => {
		const blocks = Array.from({ length: 12 }, (_, index) => ({
			type: "tool_call" as const,
			toolCallId: `tool-${index}`,
			toolName: "edit",
			args: {},
			status: "success" as const,
			uiDetails: { diff: Array.from({ length: 300 }, () => "+ hidden diff line").join("\n") },
		}));
		const message = createConversationAgentMessage({ id: "tool-heavy-agent", text: "", blocks });

		const [estimate] = buildMessageHeightEstimates([message], "tool-heavy-conversation");

		// The transcript renders these consecutive blocks as one collapsed ToolCallGroupView.
		expect(estimate).toBeGreaterThanOrEqual(100);
		expect(estimate).toBeLessThan(300);
	});

	it("keeps an approved plan entry separate from surrounding collapsed tool activity", () => {
		const message = createConversationAgentMessage({
			id: "approved-plan-agent",
			text: "",
			blocks: [
				{
					type: "tool_call",
					toolCallId: "plan-tool",
					toolName: "exit_plan_mode",
					args: {},
					status: "success",
					uiDetails: { planReview: { decision: "approve", plan: "1. Ship" } },
				},
				{
					type: "tool_call",
					toolCallId: "ordinary-tool",
					toolName: "edit",
					args: {},
					status: "success",
				},
			],
		});

		const [estimate] = buildMessageHeightEstimates([message], "approved-plan-conversation");

		// The approved plan is rendered as a persistent entry card, followed by one collapsed tool row.
		expect(estimate).toBeGreaterThanOrEqual(280);
		expect(estimate).toBeLessThan(400);
	});

	it("reuses a measured row height and ignores it after the message content revision changes", () => {
		const scope = "measured-conversation";
		const initial = createConversationAgentMessage({
			id: "measured-agent",
			text: "short",
			blocks: [{ type: "text", id: "measured-text", text: "short" }],
		});
		const element = document.createElement("div");
		element.dataset.itemIndex = "0";
		Object.defineProperty(element, "offsetHeight", { configurable: true, value: 2_645 });

		const itemSize = createMessageItemSizeRecorder([initial], scope);
		expect(itemSize(element, "offsetHeight")).toBe(2_645);
		expect(buildMessageHeightEstimates([initial], scope)).toEqual([2_645]);

		const changedText = "这段替换内容与原文等长".slice(0, "short".length);
		const changed = createConversationAgentMessage({
			id: "measured-agent",
			text: changedText,
			blocks: [{ type: "text", id: "measured-text", text: changedText }],
		});
		const [changedEstimate] = buildMessageHeightEstimates([changed], scope);

		expect(changedEstimate).not.toBe(2_645);
		expect(changedEstimate).toBeLessThan(200);
	});

	it("keeps the latest measured height for the next render of the same message revision", () => {
		const item = createConversationAgentMessage({
			id: "anchor-agent",
			text: "short",
			blocks: [{ type: "text", id: "anchor-text", text: "short" }],
		});
		const scope = "remeasured-conversation";
		const itemSize = createMessageItemSizeRecorder([item], scope);
		const element = document.createElement("div");
		element.dataset.itemIndex = "0";
		let measuredHeight = 460;
		Object.defineProperty(element, "offsetHeight", {
			configurable: true,
			get: () => measuredHeight,
		});

		itemSize(element, "offsetHeight");
		measuredHeight = 520;
		itemSize(element, "offsetHeight");

		expect(buildMessageHeightEstimates([item], scope)).toEqual([520]);
	});
});
