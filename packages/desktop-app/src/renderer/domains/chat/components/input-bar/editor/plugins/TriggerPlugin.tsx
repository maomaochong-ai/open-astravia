import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";
import { $readTriggerBeforeCaret, type TriggerMatch } from "../tokens/trigger";

export interface TriggerPluginProps {
	onTriggerChange: (trigger: TriggerMatch | null) => void;
}

/**
 * 把光标前的 `/` / `@` 触发词上报给 InputBar，由它决定开哪个面板。
 *
 * 没有触发词时上报 null 且不重复上报：否则每敲一个普通字符都要穿一遍
 * setState → InputBar 重渲染，而绝大多数按键根本不涉及面板。
 */
export function TriggerPlugin({ onTriggerChange }: TriggerPluginProps): null {
	const [editor] = useLexicalComposerContext();
	const onTriggerChangeRef = useRef(onTriggerChange);
	onTriggerChangeRef.current = onTriggerChange;
	const lastRef = useRef<TriggerMatch | null>(null);

	useEffect(() => {
		return editor.registerUpdateListener(({ editorState }) => {
			const next = editorState.read(() => $readTriggerBeforeCaret());
			const last = lastRef.current;
			if (next === null && last === null) return;
			if (next !== null && last !== null && next.kind === last.kind && next.query === last.query) return;
			lastRef.current = next;
			onTriggerChangeRef.current(next);
		});
	}, [editor]);

	return null;
}
