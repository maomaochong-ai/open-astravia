import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";
import { activeInputDraftKeyAtom, getSessionInputHistory, inputValueAtom } from "@shared/store/atoms";
import { useStore } from "jotai";
import {
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
} from "lexical";
import { useEffect, useRef } from "react";
import { $applySegments, $readSegments } from "../tokens/segments";

/**
 * 终端式 ↑ / ↓ 浏览本作用域已发送输入。
 *
 * 激活条件（避免打乱多行编辑）：
 * - ↑：输入为空，或光标在文档起点；已在浏览态时继续向上
 * - ↓：仅在已进入历史浏览态时拦截
 *
 * 首次 ↑ 会 stash 当前未发送草稿，↓ 回到最新后还原 stash。
 */
export function HistoryNavPlugin(): null {
	const [editor] = useLexicalComposerContext();
	const store = useStore();
	/** -1 = 实时草稿；0..n-1 = 历史下标（旧→新，与 map 一致）。 */
	const indexRef = useRef(-1);
	const stashRef = useRef<string | null>(null);
	/** 正在由本插件写入，忽略这次 update 对 index 的重置。 */
	const writingRef = useRef(false);

	useEffect(() => {
		return editor.registerUpdateListener(({ editorState, tags }) => {
			if (writingRef.current || tags.has("history-nav")) return;
			// 用户手动改字 → 退出浏览态（保留已填入的文本作为新草稿）。
			if (indexRef.current === -1) return;
			const text = editorState.read(() => segmentsToText($readSegments()));
			const key = store.get(activeInputDraftKeyAtom);
			const history = getSessionInputHistory(key);
			const expected = history[indexRef.current];
			if (expected !== undefined && text === expected) return;
			indexRef.current = -1;
			stashRef.current = null;
		});
	}, [editor, store]);

	// 作用域切换时重置浏览态。
	useEffect(() => {
		return store.sub(activeInputDraftKeyAtom, () => {
			indexRef.current = -1;
			stashRef.current = null;
		});
	}, [store]);

	useEffect(() => {
		const fill = (text: string): void => {
			writingRef.current = true;
			editor.update(
				() => {
					$applySegments(parseInputSegments(text).segments);
				},
				{ tag: "history-nav" },
			);
			// atom 也会被 ValueBridge 同步；显式写一次避免竞态。
			store.set(inputValueAtom, text);
			queueMicrotask(() => {
				writingRef.current = false;
			});
		};

		const canStartHistoryUp = (): boolean => {
			return editor.getEditorState().read(() => {
				const serialized = segmentsToText($readSegments());
				if (serialized.trim().length === 0) return true;

				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
				const anchor = selection.anchor;
				if (anchor.offset !== 0) return false;

				const root = $getRoot();
				const firstPara = root.getFirstChild();
				if (!firstPara) return true;
				if (anchor.getNode().getKey() === firstPara.getKey()) return true;
				if (!$isElementNode(firstPara)) {
					return anchor.getNode().getKey() === firstPara.getKey();
				}
				const firstContent = firstPara.getFirstChild();
				if (!firstContent) return true;
				return anchor.getNode().getKey() === firstContent.getKey();
			});
		};

		const onUp = (event: KeyboardEvent | null): boolean => {
			if (event?.isComposing) return false;
			const key = store.get(activeInputDraftKeyAtom);
			const history = getSessionInputHistory(key);
			if (history.length === 0) return false;

			const browsing = indexRef.current >= 0;
			if (!browsing && !canStartHistoryUp()) return false;

			if (!browsing) {
				stashRef.current = store.get(inputValueAtom);
				indexRef.current = history.length - 1;
			} else if (indexRef.current > 0) {
				indexRef.current -= 1;
			} else {
				event?.preventDefault();
				return true;
			}

			fill(history[indexRef.current] ?? "");
			event?.preventDefault();
			return true;
		};

		const onDown = (event: KeyboardEvent | null): boolean => {
			if (event?.isComposing) return false;
			if (indexRef.current < 0) return false;

			const key = store.get(activeInputDraftKeyAtom);
			const history = getSessionInputHistory(key);

			if (indexRef.current < history.length - 1) {
				indexRef.current += 1;
				fill(history[indexRef.current] ?? "");
			} else {
				indexRef.current = -1;
				const stash = stashRef.current ?? "";
				stashRef.current = null;
				fill(stash);
			}
			event?.preventDefault();
			return true;
		};

		const unsubUp = editor.registerCommand(KEY_ARROW_UP_COMMAND, onUp, COMMAND_PRIORITY_LOW);
		const unsubDown = editor.registerCommand(KEY_ARROW_DOWN_COMMAND, onDown, COMMAND_PRIORITY_LOW);
		return () => {
			unsubUp();
			unsubDown();
		};
	}, [editor, store]);

	return null;
}
