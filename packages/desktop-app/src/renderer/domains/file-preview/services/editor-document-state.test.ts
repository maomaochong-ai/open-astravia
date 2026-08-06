import type { FsEditableTextSnapshot } from "@preload/fs-types";
import { describe, expect, it } from "vitest";
import {
	applyEditorSaveResult,
	createEditorDocument,
	isEditorDocumentDirty,
	mergeEditorSnapshot,
	updateEditorDraft,
} from "./editor-document-state";

function snapshot(content: string, revision: string): FsEditableTextSnapshot {
	return {
		content,
		revision,
		hasBom: false,
		lineEnding: "lf",
		size: content.length,
		modifiedAt: 1,
	};
}

describe("editor document state", () => {
	it("replaces a clean document when the file changes on disk", () => {
		const current = createEditorDocument("notes.txt", snapshot("one", "rev-1"));

		const next = mergeEditorSnapshot(current, "notes.txt", snapshot("two", "rev-2"));

		expect(next).toMatchObject({
			savedContent: "two",
			draftContent: "two",
			revision: "rev-2",
			editorGeneration: current.editorGeneration + 1,
		});
	});

	it("keeps a dirty draft and marks an external conflict", () => {
		const current = updateEditorDraft(createEditorDocument("notes.txt", snapshot("one", "rev-1")), "local edit");

		const next = mergeEditorSnapshot(current, "notes.txt", snapshot("external edit", "rev-2"));

		expect(next).toMatchObject({
			savedContent: "one",
			draftContent: "local edit",
			revision: "rev-1",
			conflictRevision: "rev-2",
			editorGeneration: current.editorGeneration,
		});
	});

	it("keeps edits made while an earlier draft is being saved", () => {
		const savingDocument = updateEditorDraft(
			createEditorDocument("notes.txt", snapshot("one", "rev-1")),
			"first edit",
		);
		const current = updateEditorDraft(savingDocument, "second edit");

		const next = applyEditorSaveResult(current, savingDocument.draftContent, {
			status: "saved",
			revision: "rev-2",
			size: 10,
			modifiedAt: 2,
		});

		expect(next.savedContent).toBe("first edit");
		expect(next.draftContent).toBe("second edit");
		expect(next.revision).toBe("rev-2");
		expect(next.editorGeneration).toBe(current.editorGeneration);
		expect(isEditorDocumentDirty(next)).toBe(true);
	});

	it("does not clear a draft when saving detects a conflict", () => {
		const current = updateEditorDraft(createEditorDocument("notes.txt", snapshot("one", "rev-1")), "local edit");

		const next = applyEditorSaveResult(current, current.draftContent, {
			status: "conflict",
			revision: "rev-2",
		});

		expect(next.draftContent).toBe("local edit");
		expect(next.conflictRevision).toBe("rev-2");
		expect(next.editorGeneration).toBe(current.editorGeneration);
		expect(isEditorDocumentDirty(next)).toBe(true);
	});

	it("preserves editorGeneration across a successful save so undo history can survive", () => {
		const current = updateEditorDraft(createEditorDocument("notes.txt", snapshot("one", "rev-1")), "local edit");

		const next = applyEditorSaveResult(current, current.draftContent, {
			status: "saved",
			revision: "rev-2",
			size: 10,
			modifiedAt: 2,
		});

		expect(next.revision).toBe("rev-2");
		expect(next.savedContent).toBe("local edit");
		expect(next.editorGeneration).toBe(0);
		expect(isEditorDocumentDirty(next)).toBe(false);
	});

	it("bumps editorGeneration when discarding draft from disk", () => {
		const current = updateEditorDraft(createEditorDocument("notes.txt", snapshot("one", "rev-1")), "local edit");
		const reloaded = createEditorDocument("notes.txt", snapshot("one", "rev-1"), current.editorGeneration);
		expect(reloaded.editorGeneration).toBe(current.editorGeneration + 1);
		expect(reloaded.draftContent).toBe("one");
	});
});
