import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { parseInputSegments, serializeInputSegments, segmentsToText, type InputSegment } from "@shared/lib/input-tokens";
import { useEffect, useRef } from "react";
import { $applySegments, $readSegments } from "../tokens/segments";

const CONTROLLED_SYNC_TAG = "input-editor-controlled-sync";

function inputSegmentsEqual(left: readonly InputSegment[], right: readonly InputSegment[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((segment, index) => {
		const candidate = right[index];
		if (!candidate || segment.kind !== candidate.kind) return false;
		switch (segment.kind) {
			case "text":
				return candidate.kind === "text" && segment.text === candidate.text;
			case "member":
				return (
					candidate.kind === "member" &&
					segment.memberId === candidate.memberId &&
					segment.handle === candidate.handle &&
					segment.label === candidate.label &&
					segment.avatar === candidate.avatar &&
					segment.meta === candidate.meta
				);
			case "skill":
			case "scene":
				return (
					candidate.kind === segment.kind &&
					segment.name === candidate.name &&
					segment.alias === candidate.alias &&
					segment.icon === candidate.icon
				);
			case "connector":
				return (
					candidate.kind === "connector" &&
					segment.name === candidate.name &&
					segment.label === candidate.label &&
					segment.iconUrl === candidate.iconUrl
				);
			case "file":
				return (
					candidate.kind === "file" &&
					segment.path === candidate.path &&
					segment.isDirectory === candidate.isDirectory
				);
			case "image":
				return candidate.kind === "image" && segment.path === candidate.path;
		}
	});
}

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
		const projectedSegments = segments ?? parseInputSegments(value).segments;
		const currentSegments = editor.getEditorState().read(() => $readSegments());
		if (segmentsToText(currentSegments) === value && inputSegmentsEqual(currentSegments, projectedSegments)) return;
		editor.update(() => $applySegments(projectedSegments), { tag: CONTROLLED_SYNC_TAG });
	}, [editor, segments, value]);

	return null;
}
