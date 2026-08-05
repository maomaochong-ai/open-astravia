import type { AssetKind, ContentAsset, ContentPromptDocument, ContentPromptSegment } from "../project/types";

const TOKEN_ICON_CLASS: Record<AssetKind, string> = {
	image: "icon-[lucide--image]",
	video: "icon-[lucide--video]",
	audio: "icon-[lucide--audio-lines]",
};

export interface PromptMentionContext {
	query: string;
	range: Range;
}

export function renderPromptEditor(
	editor: HTMLElement,
	document: ContentPromptDocument,
	assetByBindingId: ReadonlyMap<string, ContentAsset>,
	removeLabel: string,
): void {
	editor.replaceChildren();
	for (const segment of document.segments) {
		if (segment.type === "text") {
			editor.append(documentNode(editor, segment.text));
			continue;
		}
		const asset = assetByBindingId.get(segment.bindingId);
		if (asset) editor.append(createAssetToken(editor, segment.bindingId, asset, removeLabel));
	}
}

export function readPromptEditor(editor: HTMLElement): ContentPromptDocument {
	const segments: ContentPromptSegment[] = [];
	readChildNodes(editor, segments);
	return { version: 1, segments: mergeTextSegments(segments) };
}

export function getPromptMentionContext(editor: HTMLElement): PromptMentionContext | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
	const caret = selection.getRangeAt(0);
	if (!editor.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
	const text = caret.startContainer.textContent ?? "";
	const preceding = text.slice(0, caret.startOffset);
	const match = preceding.match(/(?:^|\s)@([^@\s]*)$/u);
	if (!match) return null;
	const query = match[1] ?? "";
	const range = editor.ownerDocument.createRange();
	range.setStart(caret.startContainer, caret.startOffset - query.length - 1);
	range.setEnd(caret.startContainer, caret.startOffset);
	return { query, range };
}

export function insertPromptAssetToken(
	editor: HTMLElement,
	range: Range | null,
	bindingId: string,
	asset: ContentAsset,
	removeLabel: string,
): void {
	const insertionRange = range && editor.contains(range.commonAncestorContainer) ? range : rangeAtEditorEnd(editor);
	insertionRange.deleteContents();
	const token = createAssetToken(editor, bindingId, asset, removeLabel);
	const trailingSpace = editor.ownerDocument.createTextNode(" ");
	insertionRange.insertNode(trailingSpace);
	insertionRange.insertNode(token);
	const selection = window.getSelection();
	if (!selection) return;
	const nextRange = editor.ownerDocument.createRange();
	nextRange.setStartAfter(trailingSpace);
	nextRange.collapse(true);
	selection.removeAllRanges();
	selection.addRange(nextRange);
	editor.focus();
}

export function placePromptCaretAtEnd(editor: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection) return;
	const range = rangeAtEditorEnd(editor);
	selection.removeAllRanges();
	selection.addRange(range);
	editor.focus();
}

export function getPromptSelectionRange(editor: HTMLElement): Range | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function createAssetToken(
	editor: HTMLElement,
	bindingId: string,
	asset: ContentAsset,
	removeLabel: string,
): HTMLElement {
	const token = editor.ownerDocument.createElement("span");
	token.contentEditable = "false";
	token.dataset.promptBindingId = bindingId;
	token.className =
		"mx-0.5 inline-flex max-w-[220px] translate-y-[1px] items-center gap-1 rounded-md border border-primary/20 bg-primary/8 px-1.5 py-0.5 align-baseline text-[12px] font-medium text-foreground";

	const icon = editor.ownerDocument.createElement("span");
	icon.className = `${TOKEN_ICON_CLASS[asset.kind]} block size-3 shrink-0 text-primary/75`;
	icon.ariaHidden = "true";
	const name = editor.ownerDocument.createElement("span");
	name.className = "max-w-36 truncate";
	name.textContent = asset.name;
	const remove = editor.ownerDocument.createElement("span");
	remove.dataset.removePromptBindingId = bindingId;
	remove.className =
		"icon-[lucide--x] block size-3 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground";
	remove.role = "button";
	remove.tabIndex = 0;
	remove.ariaLabel = removeLabel;
	token.append(icon, name, remove);
	return token;
}

function readChildNodes(parent: Node, segments: ContentPromptSegment[]): void {
	for (const node of parent.childNodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (node.textContent) segments.push({ type: "text", text: node.textContent });
			continue;
		}
		if (!(node instanceof HTMLElement)) continue;
		const bindingId = node.dataset.promptBindingId;
		if (bindingId) {
			segments.push({ type: "asset-reference", bindingId });
			continue;
		}
		if (node.tagName === "BR") {
			segments.push({ type: "text", text: "\n" });
			continue;
		}
		const isBlock = node.tagName === "DIV" || node.tagName === "P";
		if (isBlock && segments.length > 0) segments.push({ type: "text", text: "\n" });
		readChildNodes(node, segments);
	}
}

function mergeTextSegments(segments: readonly ContentPromptSegment[]): ContentPromptSegment[] {
	const merged: ContentPromptSegment[] = [];
	for (const segment of segments) {
		const previous = merged.at(-1);
		if (segment.type === "text" && previous?.type === "text") previous.text += segment.text;
		else merged.push({ ...segment });
	}
	return merged;
}

function rangeAtEditorEnd(editor: HTMLElement): Range {
	const range = editor.ownerDocument.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	return range;
}

function documentNode(editor: HTMLElement, text: string): Text {
	return editor.ownerDocument.createTextNode(text);
}
