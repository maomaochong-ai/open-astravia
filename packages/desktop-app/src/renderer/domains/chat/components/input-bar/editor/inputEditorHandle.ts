import type { InputSegment } from "@shared/lib/input-tokens";
import {
	$createRangeSelection,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	$nodesOfType,
	$setSelection,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";
import {
	$createConnectorTokenNode,
	$createFileTokenNode,
	$createImageTokenNode,
	$createSkillTokenNode,
	ImageTokenNode,
} from "./nodes";
import { $applySegments, $insertTokenNodes } from "./tokens/segments";
import { $removeTriggerBeforeCaret } from "./tokens/trigger";

/**
 * 当前挂载的输入编辑器。
 *
 * 输入框的真相源是 Lexical EditorState，但插 token 的调用方散落在 composer 之外
 * （面板选中、@ 面板、拖拽、插件 setInputValue、首屏 skill 快选），全部 prop 下钻
 * 既啰嗦又要穿过 theme-ui 的视图边界，因此这里用一个模块级 handle 收口。
 * 同一时刻只可能有一个 InputBar 挂载（会话页与新会话页是不同路由）。
 * 未挂载时所有操作静默 no-op——批量任务 dialog 用的是自己的 textarea。
 */
let current: LexicalEditor | null = null;
let speechRange: { key: string; start: number; end: number } | null = null;

export function setInputEditor(editor: LexicalEditor | null): void {
	current = editor;
	if (!editor) speechRange = null;
}

export function getInputEditor(): LexicalEditor | null {
	return current;
}

export interface InsertTokenOptions {
	/**
	 * 面板选中时为 true：先回删用户键入的 `/foo` / `@foo` 触发词，再插 token。
	 * 拖拽、插件注入等没有触发词的入口必须留 false，否则会吃掉光标前的普通单词。
	 */
	replaceTrigger?: boolean;
}

function insert(nodes: () => LexicalNode[], options?: InsertTokenOptions): void {
	current?.update(() => {
		if (options?.replaceTrigger) $removeTriggerBeforeCaret();
		$insertTokenNodes(nodes());
	});
}

export function insertSkillToken(name: string, alias?: string, icon?: string, options?: InsertTokenOptions): void {
	insert(() => [$createSkillTokenNode(name, alias, icon)], options);
}

export function insertConnectorToken(
	name: string,
	label: string,
	iconUrl?: string,
	options?: InsertTokenOptions,
): void {
	insert(() => [$createConnectorTokenNode(name, label, iconUrl)], options);
}

export function insertFileToken(path: string, isDirectory = false, options?: InsertTokenOptions): void {
	insert(() => [$createFileTokenNode(path, isDirectory)], options);
}

export function insertImageToken(path: string, options?: InsertTokenOptions): void {
	insert(() => [$createImageTokenNode(path)], options);
}

/** 从文本流里移除某张图片的 token（上方缩略图行的 × 按钮）。 */
export function removeImageToken(path: string): void {
	current?.update(() => {
		for (const node of $nodesOfType(ImageTokenNode)) {
			if (node.getPath() === path) node.remove();
		}
	});
}

/** 整体替换内容（重编辑回填、外部 setInputValue）。 */
export function replaceInputSegments(segments: readonly InputSegment[]): void {
	current?.update(() => {
		$applySegments(segments);
	});
}

export function focusInputEditor(): void {
	current?.focus();
}

/** 当前选区文本；无选区返回空串。右键菜单的复制/剪切依赖它。 */
export function readSelectionText(): string {
	if (!current) return "";
	return current.getEditorState().read(() => {
		const selection = $getSelection();
		if (!$isRangeSelection(selection) || selection.isCollapsed()) return "";
		return selection.getTextContent();
	});
}

export function removeSelection(): void {
	current?.update(() => {
		const selection = $getSelection();
		if ($isRangeSelection(selection) && !selection.isCollapsed()) selection.removeText();
	});
}

/** 在光标处插入纯文本（右键粘贴）。选区非空时替换选区。 */
export function insertPlainText(text: string): void {
	current?.update(() => {
		const selection = $getSelection();
		if ($isRangeSelection(selection)) selection.insertText(text);
	});
}

/** 流式语音文本：后续 partial 替换上一次识别片段，而不是不断追加。 */
export function replaceSpeechText(text: string): void {
	if (!text) return;
	current?.update(() => {
		const selection = $getSelection();
		const previous = speechRange;
		const previousNode = previous ? $getNodeByKey(previous.key) : null;
		const canReplace =
			previous &&
			$isTextNode(previousNode) &&
			$isRangeSelection(selection) &&
			selection.isCollapsed() &&
			selection.anchor.key === previous.key &&
			selection.anchor.offset === previous.end;
		if (canReplace) {
			const range = $createRangeSelection();
			range.setTextNodeRange(previousNode, previous.start, previousNode, previous.end);
			$setSelection(range);
		}
		const nextSelection = $getSelection();
		if (!$isRangeSelection(nextSelection)) {
			speechRange = null;
			return;
		}
		nextSelection.insertText(text);
		const end = nextSelection.anchor.offset;
		speechRange = { key: nextSelection.anchor.key, start: end - text.length, end };
	});
}

export function clearSpeechText(): void {
	speechRange = null;
}
