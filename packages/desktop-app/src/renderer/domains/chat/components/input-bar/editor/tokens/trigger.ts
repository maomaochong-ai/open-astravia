import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";

export interface TriggerMatch {
	kind: "slash" | "at";
	/** 触发符之后已键入的过滤词。 */
	query: string;
	/** 含触发符本身的字符数，用于选中后回删。 */
	length: number;
}

/**
 * 词首的 `/` 或 `@` 才算触发。
 * 旧实现要求 `/` 位于整个输入的开头，行内多 token 就插不进第二个 skill；
 * 这里放宽到「行首或空白之后」，`2026/07/30`、`a@b.com` 因此不会误触发。
 */
const TRIGGER_RE = /(?:^|\s)([/@])(\S*)$/;

export function matchTrigger(textBeforeCaret: string): TriggerMatch | null {
	const match = textBeforeCaret.match(TRIGGER_RE);
	if (!match) return null;
	const [, symbol, query] = match;
	return {
		kind: symbol === "/" ? "slash" : "at",
		query,
		length: query.length + 1,
	};
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
