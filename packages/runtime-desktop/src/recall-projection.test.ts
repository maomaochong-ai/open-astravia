import type { ConversationDocument } from "@astravia/runtime-core";
import { describe, expect, it } from "vitest";
import { projectRecallEntries } from "./recall-projection.js";

/**
 * G3 召回投影回归测试：projectRecallEntries 决定 recall 工具能搜到什么。
 *
 * 关键语义：被压缩掉的细节（文件内容、命令输出、早期决策）落在 assistant / toolResult
 * 消息里，必须被投影；压缩/分支摘要也要可召回；元数据条目与空文本跳过。
 */

function makeDocument(entries: unknown[]): ConversationDocument {
	return { entries } as unknown as ConversationDocument;
}

describe("projectRecallEntries", () => {
	it("投影 user/assistant/toolResult 消息，带角色与文本", () => {
		const doc = makeDocument([
			{ id: "e1", type: "message", message: { role: "user", content: [{ type: "text", text: "帮我读一下 config.ts" }] } },
			{ id: "e2", type: "message", message: { role: "assistant", content: "好的，我来读取文件。" } },
			{ id: "e3", type: "message", message: { role: "toolResult", content: [{ type: "text", text: "export const config = {};" }] } },
		]);
		const entries = projectRecallEntries(doc);
		expect(entries).toHaveLength(3);
		expect(entries[0]).toEqual({ entryId: "e1", role: "user", text: "帮我读一下 config.ts" });
		expect(entries[1]).toEqual({ entryId: "e2", role: "assistant", text: "好的，我来读取文件。" });
		expect(entries[2]).toEqual({ entryId: "e3", role: "toolResult", text: "export const config = {};" });
	});

	it("投影 compaction / branch_summary 摘要", () => {
		const doc = makeDocument([
			{ id: "c1", type: "compaction", summary: "## 已完成\n- 压缩了早期对话" },
			{ id: "b1", type: "branch_summary", summary: "分支摘要：切换到方案 B" },
		]);
		const entries = projectRecallEntries(doc);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({ entryId: "c1", role: "compaction", text: "## 已完成\n- 压缩了早期对话" });
		expect(entries[1]).toEqual({ entryId: "b1", role: "branch_summary", text: "分支摘要：切换到方案 B" });
	});

	it("投影 custom_message，跳过元数据条目与空文本", () => {
		const doc = makeDocument([
			{ id: "m1", type: "custom_message", content: [{ type: "text", text: "自定义消息内容" }] },
			{ id: "l1", type: "label", label: "checkpoint" },
			{ id: "mc1", type: "model_change", model: "gpt-5" },
			{ id: "e4", type: "message", message: { role: "assistant", content: [] } },
		]);
		const entries = projectRecallEntries(doc);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({ entryId: "m1", role: "custom", text: "自定义消息内容" });
	});
});
