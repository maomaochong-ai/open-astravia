import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseInputSegments, serializeInputSegments, segmentsToText, type InputSegment } from "@shared/lib/input-tokens";
import { useEffect, useRef } from "react";
import { $applySegments, $readSegments } from "../tokens/segments";

const CONTROLLED_SYNC_TAG = "input-editor-controlled-sync";

/** Token-aware controlled projection used by non-default conversation connectors. */
export function ControlledValueBridgePlugin({
	value,
	segments,
	onValueChange,
}: {
	readonly value: string;
	readonly segments?: readonly InputSegment[];
	readonly onValueChange: (value: string, segments?: readonly InputSegment[]) => void;
}): null {
	const [editor] = useLexicalComposerContext();
	const projectedValueRef = useRef(value);
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	useEffect(
		() =>
			editor.registerUpdateListener(({ editorState, tags }) => {
				if (tags.has(CONTROLLED_SYNC_TAG)) return;
				const segments = editorState.read(() => $readSegments());
				const next = serializeInputSegments(segments).text;
				if (next === projectedValueRef.current) return;
				projectedValueRef.current = next;
				onValueChangeRef.current(next, segments);
			}),
		[editor],
	);

	useEffect(() => {
		projectedValueRef.current = value;
		const current = editor.getEditorState().read(() => segmentsToText($readSegments()));
		if (current === value) return;
		editor.update(() => $applySegments(segments ?? parseInputSegments(value).segments), { tag: CONTROLLED_SYNC_TAG });
	}, [editor, segments, value]);

	return null;
}
