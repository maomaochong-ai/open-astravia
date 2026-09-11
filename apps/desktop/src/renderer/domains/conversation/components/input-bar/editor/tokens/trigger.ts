import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";

export interface TriggerMatch {
	kind: "slash" | "at";
	/** 触发符之后已键入的过滤词。 */
	query: string;
	/** 含触发符本身的字符数，用于选中后回删。 */
	length: number;
}

/**
 * `/` 和 `@` 都可以在已有文字后开始筛选；一次粘贴完整触发词与逐字输入
 * 走同一条解析路径。匹配尾部第一个触发符，使 `@src/file.ts` 仍属于 @ 文件搜索。
 */
const TRAILING_TRIGGER_RE = /([/@])(\S*)$/;

/** 常见邮箱保持为普通文本；显式在空白后输入 `@` 仍可搜索带点的 handle。 */
const EMAIL_LIKE_RE = /(?:^|\s)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function matchTrigger(textBeforeCaret: string): TriggerMatch | null {
	const match = textBeforeCaret.match(TRAILING_TRIGGER_RE);
	if (!match || match.index === undefined) return null;
	const [, symbol, query] = match;
	const preceding = match.index > 0 ? textBeforeCaret[match.index - 1] : "";

	if (symbol === "/") {
		if (query.includes("/") || /[\d/:]/.test(preceding)) return null;
		return { kind: "slash", query, length: query.length + 1 };
	}

	if (query.includes("@") || EMAIL_LIKE_RE.test(textBeforeCaret)) return null;
	return { kind: "at", query, length: query.length + 1 };
}

/** 读取光标前的触发词；光标不在文本节点里（例如紧贴 token）时返回 null。 */
export function $readTriggerBeforeCaret(): TriggerMatch | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
	const node = selection.anchor.getNode();
	if (!$isTextNode(node)) return null;
	return matchTrigger(node.getTextContent().slice(0, selection.anchor.offset));
}

/** 删除光标前的触发词——面板选中后由 token 取代它。 */
export function $removeTriggerBeforeCaret(): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
	const node = selection.anchor.getNode();
	if (!$isTextNode(node)) return;
	const offset = selection.anchor.offset;
	const trigger = matchTrigger(node.getTextContent().slice(0, offset));
	if (!trigger) return;
	node.spliceText(offset - trigger.length, trigger.length, "", true);
}
