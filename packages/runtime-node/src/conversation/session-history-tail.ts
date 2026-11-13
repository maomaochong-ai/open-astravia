import { open } from "node:fs/promises";
import type { HistoryEntry } from "@astravia/runtime-core";

/**
 * 会话文件尾部的「快速预览」读取。
 *
 * 为什么需要：打开一个已有会话时，首屏内容完全取决于一次「读全文 + 解析 + 投影」。
 * 实测 2 MB 会话约 220 ms、6.5 MB 约 2 s，慢的这部分就是解析全部历史。
 *
 * 关键点：会话 JSONL 的每一行本身就是一条 `HistoryEntry`，所以只读最后一段字节、
 * 逐行 `JSON.parse`，就已经是一份可用的历史——不需要走严格校验的 codec，也不要求
 * 序号连续。这里刻意只做这一层，**不**去猜 turn 边界：把尾部若干条交给渲染层已有的
 * `fullHistoryToChat` 投影，行的 id 都来自 `entryId`，随后被完整历史替换时不会错位。
 *
 * 约束（都在下面代码里体现）：
 * - 首行可能是被切断的半行，必须丢掉；
 * - 单行损坏就跳过，不能让预览整块失败；
 * - 不保证覆盖完整历史，调用方必须把它当作「临时内容」，随后用完整历史替换。
 */
export const SESSION_PREVIEW_TAIL_BYTES = 256 * 1024;

/** 只读文件尾部的字节，返回解析出的记录；文件比预算短时 truncated 为 false。 */
export async function readSessionHistoryTail(
	filePath: string,
	tailBytes: number = SESSION_PREVIEW_TAIL_BYTES,
): Promise<SessionHistoryTail> {
	const handle = await open(filePath, "r");
	try {
		const { size } = await handle.stat();
		const length = Math.min(size, tailBytes);
		const start = size - length;
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, start);
		const text = buffer.toString("utf8");
		// 从中间开始读时首行一定是半行；从头读时首行是完整记录（文件头），要一起丢掉，
		// 因为预览只关心消息，文件头不是 HistoryEntry 形状的独立条目也得让渲染层自己判。
		return { history: parseHistoryTailText(text, start > 0), truncated: start > 0 };
	} finally {
		await handle.close();
	}
}

export interface SessionHistoryTail {
	readonly history: HistoryEntry[];
	/** true 表示只返回了尾部片段，调用方应尽快用完整历史替换。 */
	readonly truncated: boolean;
}

/**
 * 会话文件的每一行是一条信封记录：`{ recordType: "conversation.event", event: {...} }`，
 * 也可能是 `{ recordType: "conversation.seed" | ... }` 这类非事件记录。历史条目是里面的
 * `event`。早期/兼容写法里也有把事件直接铺在顶层的，两种都认。
 */
function unwrapRecord(value: unknown): HistoryEntry | null {
	if (!value || typeof value !== "object") return null;
	const record = value as { type?: unknown; event?: unknown };
	if (record.event && typeof record.event === "object") {
		const event = record.event as { type?: unknown };
		if (typeof event.type === "string") return event as HistoryEntry;
	}
	if (typeof record.type === "string") return record as HistoryEntry;
	return null;
}

/** 逐行解析尾部文本：丢首行（可能被截断）、跳过坏行、只保留能还原成事件的行。 */
export function parseHistoryTailText(text: string, droppedLeadingLine = true): HistoryEntry[] {
	const lines = text.split("\n");
	// 文件末尾通常带换行，split 会多出一个空串。
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const start = droppedLeadingLine ? 1 : 0;
	const entries: HistoryEntry[] = [];
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i]?.replace(/\r$/, "");
		if (!line) continue;
		try {
			const value: unknown = JSON.parse(line);
			const entry = unwrapRecord(value);
			if (entry) entries.push(entry);
		} catch {
			// 半行、损坏行都跳过：预览宁缺一条，也不能整块失败。
		}
	}
	return entries;
}
