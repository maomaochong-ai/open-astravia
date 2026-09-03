import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
} from "lexical";
import { useEffect, useRef } from "react";
import { $applySegments, $readSegments } from "../tokens/segments";

/** Token-aware terminal-style history navigation for a connector-owned draft. */
export function ControlledHistoryNavPlugin({
	history,
	value,
	onValueChange,
}: {
	readonly history: readonly string[];
	readonly value: string;
	readonly onValueChange: (value: string) => void;
}): null {
	const [editor] = useLexicalComposerContext();
	const historyRef = useRef(history);
	const valueRef = useRef(value);
	const onValueChangeRef = useRef(onValueChange);
	const indexRef = useRef(-1);
	const stashRef = useRef("");
	historyRef.current = history;
	valueRef.current = value;
	onValueChangeRef.current = onValueChange;

	useEffect(() => {
		indexRef.current = -1;
		stashRef.current = "";
	}, [history]);

	useEffect(() => {
		const fill = (next: string): void => {
			editor.update(() => $applySegments(parseInputSegments(next).segments), { tag: "controlled-history-nav" });
			onValueChangeRef.current(next);
		};
		const canStart = (): boolean =>
			editor.getEditorState().read(() => {
				if (segmentsToText($readSegments()).trim().length === 0) return true;
				const selection = $getSelection();
				return Boolean($isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.offset === 0);
			});
		const onUp = (event: KeyboardEvent | null): boolean => {
			if (event?.isComposing || historyRef.current.length === 0) return false;
			if (indexRef.current < 0) {
				if (!canStart()) return false;
				stashRef.current = valueRef.current;
				indexRef.current = historyRef.current.length - 1;
			} else if (indexRef.current > 0) {
				indexRef.current -= 1;
			}
			fill(historyRef.current[indexRef.current] ?? "");
			event?.preventDefault();
			return true;
		};
		const onDown = (event: KeyboardEvent | null): boolean => {
			if (event?.isComposing || indexRef.current < 0) return false;
			if (indexRef.current < historyRef.current.length - 1) {
				indexRef.current += 1;
				fill(historyRef.current[indexRef.current] ?? "");
			} else {
				indexRef.current = -1;
				fill(stashRef.current);
				stashRef.current = "";
			}
			event?.preventDefault();
			return true;
		};
		const unregisterUp = editor.registerCommand(KEY_ARROW_UP_COMMAND, onUp, COMMAND_PRIORITY_LOW);
		const unregisterDown = editor.registerCommand(KEY_ARROW_DOWN_COMMAND, onDown, COMMAND_PRIORITY_LOW);
		return () => {
			unregisterUp();
			unregisterDown();
		};
	}, [editor]);

	return null;
}
