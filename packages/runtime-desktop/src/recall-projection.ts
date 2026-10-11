import type { ConversationDocument } from "@astravia/runtime-core";

/**
 * recall 工具可搜索的条目投影（G3）。
 *
 * 与 runtime-core 的 extractConversationEntryText 不同：这里要召回的是**被压缩掉的细节**——
 * 文件内容、命令输出、早期决策——它们落在 assistant / toolResult 消息里，而那个函数只取
 * user 消息。所以这里统一投影所有 message 条目（user/assistant/toolResult）+ 压缩/分支摘要。
 */
export interface RecallProjectionEntry {
	readonly entryId: string;
	readonly role: string;
	readonly text: string;
}

export function projectRecallEntries(document: ConversationDocument): RecallProjectionEntry[] {
	const entries: RecallProjectionEntry[] = [];
	for (const entry of document.entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (typeof message !== "object" || message === null) continue;
			const record = message as Record<string, unknown>;
			const text = extractRecallMessageText(record.content);
			if (!text) continue;
			entries.push({ entryId: entry.id, role: typeof record.role === "string" ? record.role : "message", text });
		} else if (entry.type === "compaction") {
			if (entry.summary) entries.push({ entryId: entry.id, role: "compaction", text: entry.summary });
		} else if (entry.type === "branch_summary") {
			if (entry.summary) entries.push({ entryId: entry.id, role: "branch_summary", text: entry.summary });
		} else if (entry.type === "custom_message") {
			const text = extractRecallMessageText(entry.content);
			if (text) entries.push({ entryId: entry.id, role: "custom", text });
		}
	}
	return entries;
}

/** 从消息 content（string 或 ContentBlock[]）里抽出可搜索的文本块。 */
function extractRecallMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { readonly type: "text"; readonly text: string } =>
				typeof block === "object" &&
				block !== null &&
				(block as Record<string, unknown>).type === "text" &&
				typeof (block as Record<string, unknown>).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}
