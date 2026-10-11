import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { compact, type CompactionPreparation } from "../src/compaction/compaction.js";
import { DEFAULT_COMPACTION_SETTINGS } from "../src/compaction/contracts.js";
import { createFileOps } from "../src/compaction/summary-support.js";

/**
 * G4 召回指针（RECALL_POINTER）回归测试。
 *
 * 压缩摘要尾部应追加「Recall available」指针，告诉模型被压缩掉的细节可用 recall 工具读回。
 * 该指针仅在 recall 工具可用（宿主注入了 recallReader → recallAvailable=true）时追加，
 * 避免模型引用不存在的工具。本组用例钉住这个条件分支。
 */

const MODEL = { id: "test-model", provider: "test", api: "openai-completions" } as unknown as Model<Api>;

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

function mockCompletion(): typeof import("@astravia/ai").completeSimple {
	return async () => {
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

function makePreparation(): CompactionPreparation {
	return {
		firstKeptEntryId: "test-entry",
		messagesToSummarize: [userMessage("第一轮对话内容")],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 100,
		fileOps: createFileOps(),
		pathEntries: [],
		prevCompactionIndex: -1,
		settings: DEFAULT_COMPACTION_SETTINGS,
	};
}

describe("G4 召回指针（RECALL_POINTER）", () => {
	it("recallAvailable=true：摘要尾部追加召回指针", async () => {
		const result = await compact(makePreparation(), MODEL, "test-key", undefined, undefined, {
			completion: mockCompletion(),
			recallAvailable: true,
		});
		expect(result.summary).toContain("Recall available");
		expect(result.summary).toContain("recall");
	});

	it("recallAvailable 缺省：摘要不含召回指针（避免引用不存在的工具）", async () => {
		const result = await compact(makePreparation(), MODEL, "test-key", undefined, undefined, {
			completion: mockCompletion(),
		});
		expect(result.summary).not.toContain("Recall available");
	});

	it("recallAvailable=false：摘要不含召回指针", async () => {
		const result = await compact(makePreparation(), MODEL, "test-key", undefined, undefined, {
			completion: mockCompletion(),
			recallAvailable: false,
		});
		expect(result.summary).not.toContain("Recall available");
	});
});
