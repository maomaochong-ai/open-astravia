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
	promptLabelByNodeId: ReadonlyMap<string, string>,
	removeLabel: string,
): void {
	editor.replaceChildren();
	for (const segment of document.segments) {
		if (segment.type === "text") {
			editor.append(documentNode(editor, segment.text));
			continue;
		}
		if (segment.type === "asset-reference") {
			const asset = assetByBindingId.get(segment.bindingId);
			if (asset) editor.append(createAssetToken(editor, segment.bindingId, asset, removeLabel));
			continue;
		}
		const label = promptLabelByNodeId.get(segment.sourceNodeId);
		if (label) editor.append(createPromptToken(editor, segment.sourceNodeId, label, removeLabel));
	}
}

export function refreshPromptEditorAssetPreviews(
	editor: HTMLElement,
	assetByBindingId: ReadonlyMap<string, ContentAsset>,
): void {
	for (const token of editor.querySelectorAll<HTMLElement>("[data-prompt-binding-id]")) {
		const bindingId = token.dataset.promptBindingId;
		const asset = bindingId ? assetByBindingId.get(bindingId) : undefined;
		const preview = token.querySelector<HTMLElement>("[data-prompt-asset-preview]");
		if (asset && preview) preview.replaceWith(createAssetTokenPreview(editor, asset));
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
	const textPosition = getCaretTextPosition(editor, caret);
	if (!textPosition) return null;
	const preceding = textPosition.node.data.slice(0, textPosition.offset);
	const match = preceding.match(/(?:^|\s)@([^@\s]*)$/u);
	if (!match) return null;
	const query = match[1] ?? "";
	const range = editor.ownerDocument.createRange();
	range.setStart(textPosition.node, textPosition.offset - query.length - 1);
	range.setEnd(textPosition.node, textPosition.offset);
	return { query, range };
}

function getCaretTextPosition(editor: HTMLElement, caret: Range): { node: Text; offset: number } | null {
	if (!editor.contains(caret.startContainer)) return null;
	if (caret.startContainer instanceof Text) return { node: caret.startContainer, offset: caret.startOffset };
	const previous = caret.startContainer.childNodes.item(caret.startOffset - 1);
	if (!previous) return null;
	let candidate = previous;
	while (candidate.lastChild) candidate = candidate.lastChild;
	return candidate instanceof Text ? { node: candidate, offset: candidate.data.length } : null;
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

export function insertPromptSourceToken(
	editor: HTMLElement,
	range: Range | null,
	sourceNodeId: string,
	label: string,
	removeLabel: string,
): void {
	insertPromptToken(editor, range, createPromptToken(editor, sourceNodeId, label, removeLabel));
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
		"mx-1 inline-flex h-[22px] max-w-[180px] items-center gap-1 rounded-md border border-primary/20 bg-primary/8 px-1.5 align-middle text-[11px] leading-none font-medium text-foreground";

	const preview = createAssetTokenPreview(editor, asset);
	const name = editor.ownerDocument.createElement("span");
	name.className = "max-w-32 truncate";
	name.textContent = asset.name;
	name.title = asset.name;
	const remove = editor.ownerDocument.createElement("span");
	remove.dataset.removePromptBindingId = bindingId;
	remove.className =
		"icon-[lucide--x] block size-3 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground";
	remove.role = "button";
	remove.tabIndex = 0;
	remove.ariaLabel = removeLabel;
	token.append(preview, name, remove);
	return token;
}

function createAssetTokenPreview(editor: HTMLElement, asset: ContentAsset): HTMLElement {
	const preview = editor.ownerDocument.createElement("span");
	preview.dataset.promptAssetPreview = "";
	preview.className = "relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted";
	const icon = editor.ownerDocument.createElement("span");
	icon.className = `${TOKEN_ICON_CLASS[asset.kind]} block size-3 text-primary/75`;
	icon.ariaHidden = "true";
	preview.append(icon);
	if (asset.kind !== "image" || !asset.previewUrl) return preview;

	const image = editor.ownerDocument.createElement("img");
	image.src = asset.previewUrl;
	image.alt = "";
	image.className = "absolute inset-0 size-full object-cover";
	image.draggable = false;
	image.addEventListener("error", () => image.remove(), { once: true });
	preview.append(image);
	return preview;
}

function createPromptToken(
	editor: HTMLElement,
	sourceNodeId: string,
	label: string,
	removeLabel: string,
): HTMLElement {
	const token = editor.ownerDocument.createElement("span");
	token.contentEditable = "false";
	token.dataset.promptSourceNodeId = sourceNodeId;
	token.className =
		"mx-1 inline-flex h-[22px] max-w-[180px] items-center gap-1 rounded-md border border-border/80 bg-muted/65 px-1.5 align-middle text-[11px] leading-none font-medium text-foreground";

	const icon = editor.ownerDocument.createElement("span");
	icon.className = "icon-[lucide--message-square-text] block size-3 shrink-0 text-muted-foreground";
	icon.ariaHidden = "true";
	const name = editor.ownerDocument.createElement("span");
	name.className = "max-w-32 truncate";
	name.textContent = `@${label}`;
	name.title = label;
	const remove = editor.ownerDocument.createElement("span");
	remove.dataset.removePromptSourceNodeId = sourceNodeId;
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
		const sourceNodeId = node.dataset.promptSourceNodeId;
		if (sourceNodeId) {
			segments.push({ type: "prompt-reference", sourceNodeId });
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

function insertPromptToken(editor: HTMLElement, range: Range | null, token: HTMLElement): void {
	const insertionRange = range && editor.contains(range.commonAncestorContainer) ? range : rangeAtEditorEnd(editor);
	insertionRange.deleteContents();
	const trailingSpace = editor.ownerDocument.createTextNode(" ");
	insertionRange.insertNode(trailingSpace);
	insertionRange.insertNode(token);
	const selection = editor.ownerDocument.defaultView?.getSelection();
	if (!selection) return;
	const nextRange = editor.ownerDocument.createRange();
	nextRange.setStartAfter(trailingSpace);
	nextRange.collapse(true);
	selection.removeAllRanges();
	selection.addRange(nextRange);
	editor.focus();
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
