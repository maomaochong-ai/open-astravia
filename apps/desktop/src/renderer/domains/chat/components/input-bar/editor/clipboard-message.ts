import { createClipboardInsertionParts } from "./clipboard-message-parts";
import { insertImageToken, insertPlainText } from "./inputEditorHandle";

export function insertClipboardMessage(clipboardText: string, imagePaths: readonly string[]): void {
	for (const part of createClipboardInsertionParts(clipboardText, imagePaths)) {
		if (part.kind === "image") insertImageToken(part.path);
		else insertPlainText(part.text);
	}
}
