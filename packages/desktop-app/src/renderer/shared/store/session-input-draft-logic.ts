/** 输入草稿 / 历史的纯逻辑（无 jotai、无 DOM），便于单测。 */

export const INPUT_HISTORY_MAX = 50;

export interface SessionInputDraftLike {
	text: string;
	selectedSkill: unknown;
	appshot: unknown;
}

export function newSessionInputDraftKey(cwd: string): string {
	return `new:${cwd}`;
}

export function isSessionInputDraftEmpty(draft: SessionInputDraftLike): boolean {
	return draft.text.trim().length === 0 && draft.selectedSkill === null && draft.appshot === null;
}

/**
 * 追加一条已发送文本。与末条相同则跳过；超出 max 丢最旧。
 */
export function appendInputHistoryEntry(history: readonly string[], text: string, max = INPUT_HISTORY_MAX): string[] {
	const trimmed = text.trim();
	if (!trimmed) return history.length === 0 ? [] : [...history];
	if (history.length > 0 && history[history.length - 1] === trimmed) {
		return [...history];
	}
	const next = [...history, trimmed];
	if (next.length <= max) return next;
	return next.slice(next.length - max);
}
