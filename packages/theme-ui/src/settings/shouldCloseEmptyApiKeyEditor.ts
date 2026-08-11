/**
 * 可做 contains 判定的编辑区根（浏览器里是 HTMLElement，测试里可替身）。
 * 不绑 DOM 全局，便于 node 单测。
 */
export interface FocusContainmentRoot {
	contains(node: object | null): boolean;
}

/**
 * 预设服务商行内 API Key 编辑：空内容失焦是否应收起。
 *
 * 不用 relatedTarget 单点判定——点按钮时部分环境 relatedTarget 为 null，
 * 需结合 editorRoot.contains(activeElement) 判断焦点是否仍在编辑区内。
 */
export function shouldCloseEmptyApiKeyEditor(input: {
	readonly draftKey: string;
	readonly saving: boolean;
	readonly editorRoot: FocusContainmentRoot | null;
	/** blur 的 relatedTarget；点到非 focusable 时经常是 null。 */
	readonly relatedTarget: object | null;
	/** 失焦后已落定的 activeElement（可在 microtask 里再读）。 */
	readonly activeElement: object | null;
}): boolean {
	if (input.saving) return false;
	if (input.draftKey.trim().length > 0) return false;

	const root = input.editorRoot;
	if (!root) return true;

	if (input.relatedTarget != null && root.contains(input.relatedTarget)) {
		return false;
	}

	// relatedTarget 不可靠时，以已落定的 activeElement 为准。
	if (input.activeElement != null && root.contains(input.activeElement)) {
		return false;
	}

	return true;
}
