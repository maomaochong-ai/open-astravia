import { createClipboardInsertionParts } from "./clipboard-message-parts";
import { insertInputParts } from "./inputEditorHandle";

export function insertClipboardMessage(clipboardText: string, imagePaths: readonly string[]): void {
	insertInputParts(createClipboardInsertionParts(clipboardText, imagePaths));
}
