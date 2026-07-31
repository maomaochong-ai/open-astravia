import type { FsEditableTextSnapshot, FsSaveEditableTextResult } from "@preload/fs-types";
import type { FileEditorDocumentState } from "@shared/store/atoms";

export function createEditorDocument(path: string, snapshot: FsEditableTextSnapshot): FileEditorDocumentState {
	return {
		path,
		savedContent: snapshot.content,
		draftContent: snapshot.content,
		revision: snapshot.revision,
		hasBom: snapshot.hasBom,
		lineEnding: snapshot.lineEnding,
		size: snapshot.size,
		modifiedAt: snapshot.modifiedAt,
	};
}

export function isEditorDocumentDirty(document: FileEditorDocumentState): boolean {
	return document.draftContent !== document.savedContent;
}

export function mergeEditorSnapshot(
	document: FileEditorDocumentState | undefined,
	path: string,
	snapshot: FsEditableTextSnapshot,
): FileEditorDocumentState {
	if (!document || document.path !== path) return createEditorDocument(path, snapshot);
	if (document.revision === snapshot.revision) return document;
	if (isEditorDocumentDirty(document)) {
		return { ...document, conflictRevision: snapshot.revision };
	}
	return createEditorDocument(path, snapshot);
}

export function updateEditorDraft(document: FileEditorDocumentState, draftContent: string): FileEditorDocumentState {
	if (document.draftContent === draftContent) return document;
	return { ...document, draftContent };
}

export function applyEditorSaveResult(
	document: FileEditorDocumentState,
	savedContent: string,
	result: FsSaveEditableTextResult,
): FileEditorDocumentState {
	if (result.status === "conflict") {
		return { ...document, conflictRevision: result.revision };
	}
	return {
		...document,
		savedContent,
		revision: result.revision,
		size: result.size,
		modifiedAt: result.modifiedAt,
		conflictRevision: undefined,
	};
}
