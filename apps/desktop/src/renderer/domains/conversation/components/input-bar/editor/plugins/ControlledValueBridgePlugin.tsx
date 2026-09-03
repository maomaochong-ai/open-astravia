import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";
import { useEffect, useRef } from "react";
import { $applySegments, $readSegments } from "../tokens/segments";

const CONTROLLED_SYNC_TAG = "input-editor-controlled-sync";

/** Token-aware controlled projection used by non-default conversation connectors. */
export function ControlledValueBridgePlugin({
	value,
	onValueChange,
}: {
	readonly value: string;
	readonly onValueChange: (value: string) => void;
}): null {
	const [editor] = useLexicalComposerContext();
	const projectedValueRef = useRef(value);
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	useEffect(
		() =>
			editor.registerUpdateListener(({ editorState, tags }) => {
				if (tags.has(CONTROLLED_SYNC_TAG)) return;
				const next = editorState.read(() => segmentsToText($readSegments()));
				if (next === projectedValueRef.current) return;
				projectedValueRef.current = next;
				onValueChangeRef.current(next);
			}),
		[editor],
	);

	useEffect(() => {
		projectedValueRef.current = value;
		const current = editor.getEditorState().read(() => segmentsToText($readSegments()));
		if (current === value) return;
		editor.update(() => $applySegments(parseInputSegments(value).segments), { tag: CONTROLLED_SYNC_TAG });
	}, [editor, value]);

	return null;
}
