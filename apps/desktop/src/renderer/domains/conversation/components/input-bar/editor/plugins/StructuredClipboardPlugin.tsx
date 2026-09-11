import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { segmentsToText } from "@shared/lib/input-tokens";
import {
	COMMAND_PRIORITY_CRITICAL,
	COPY_COMMAND,
	CUT_COMMAND,
	PASTE_COMMAND,
	$getSelection,
	$isRangeSelection,
	mergeRegister,
} from "lexical";
import { useEffect } from "react";
import {
	createInputSegmentsClipboardHtml,
	INPUT_SEGMENTS_CLIPBOARD_MIME,
	readInputSegmentsFromClipboard,
} from "../clipboard-segments";
import { $insertSegments, $readSelectedSegments } from "../tokens/segments";

function isClipboardEvent(event: unknown): event is ClipboardEvent {
	return Boolean(event && typeof event === "object" && "clipboardData" in event && event.clipboardData);
}

function writeClipboardData(event: ClipboardEvent, segments: ReturnType<typeof $readSelectedSegments>): void {
	const text = segmentsToText(segments);
	// The event's native clipboardData is the most reliable way to publish a custom
	// MIME type from Electron; text/html keeps the payload available to standard apps.
	event.clipboardData?.setData("text/plain", text);
	event.clipboardData?.setData("text/html", createInputSegmentsClipboardHtml(segments));
	event.clipboardData?.setData(INPUT_SEGMENTS_CLIPBOARD_MIME, JSON.stringify({ version: 1, segments }));
}

export function StructuredClipboardPlugin(): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const copy = (event: ClipboardEvent | KeyboardEvent | null): boolean => {
			const segments = editor.getEditorState().read(() => $readSelectedSegments());
			if (segments.length === 0 || !isClipboardEvent(event)) return false;
			event.preventDefault();
			writeClipboardData(event, segments);
			return true;
		};
		const cut = (event: ClipboardEvent | KeyboardEvent | null): boolean => {
			if (!copy(event)) return false;
			editor.update(() => {
				const selection = $getSelection();
				if ($isRangeSelection(selection)) selection.removeText();
			});
			return true;
		};
		const paste = (event: ClipboardEvent | InputEvent | KeyboardEvent): boolean => {
			if (!isClipboardEvent(event)) return false;
			const clipboardData = event.clipboardData;
			if (!clipboardData) return false;
			const segments = readInputSegmentsFromClipboard(clipboardData);
			if (!segments) return false;
			event.preventDefault();
			editor.update(() => $insertSegments(segments));
			return true;
		};
		return mergeRegister(
			editor.registerCommand(COPY_COMMAND, copy, COMMAND_PRIORITY_CRITICAL),
			editor.registerCommand(CUT_COMMAND, cut, COMMAND_PRIORITY_CRITICAL),
			editor.registerCommand(PASTE_COMMAND, paste, COMMAND_PRIORITY_CRITICAL),
		);
	}, [editor]);

	return null;
}
