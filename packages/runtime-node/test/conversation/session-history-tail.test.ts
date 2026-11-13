import { describe, expect, it } from "vitest";
import { parseHistoryTailText } from "../../src/conversation/session-history-tail.js";

function line(type: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({ type, ...extra });
}

/**
 * 尾部预览的读取规则：丢被切断的首行、跳过坏行、保留其余带 type 的记录。
 * 这几条决定「首屏能否在几十毫秒内出现」，也决定坏了半行时会不会整块空白。
 */
describe("会话文件尾部解析", () => {
	it("丢掉被切断的首行，其余按原样返回", () => {
		const text = `{"type":"mess${"\n"}${line("message", { a: 1 })}\n${line("message", { a: 2 })}\n`;
		const entries = parseHistoryTailText(text);
		expect(entries).toHaveLength(2);
		expect((entries[0] as unknown as { a: number }).a).toBe(1);
	});

	it("末行没有换行也照样读出来（文件正在被追写）", () => {
		const text = `${line("message", { a: 1 })}\n${line("message", { a: 2 })}`;
		expect(parseHistoryTailText(text, false)).toHaveLength(2);
	});

	it("单行损坏只跳过那一行，不影响其它条目", () => {
		const text = `${line("message", { a: 1 })}\n{ broken json\n${line("message", { a: 3 })}\n`;
		const entries = parseHistoryTailText(text, false);
		expect(entries).toHaveLength(2);
	});

	it("没有 type 字段的 JSON 不算历史条目", () => {
		const text = `${line("message", { a: 1 })}\n{"foo":"bar"}\n`;
		expect(parseHistoryTailText(text, false)).toHaveLength(1);
	});

	it("空文本与只有空行的文本返回空数组，不抛错", () => {
		expect(parseHistoryTailText("")).toEqual([]);
		expect(parseHistoryTailText("\n\n")).toEqual([]);
	});

	it("CRLF 行尾正常工作（Windows 上写出的文件）", () => {
		const text = `${line("message", { a: 1 })}\r\n${line("message", { a: 2 })}\r\n`;
		expect(parseHistoryTailText(text, false)).toHaveLength(2);
	});
});
