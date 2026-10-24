/**
 * @vitest-environment jsdom
 */
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
	filePreviewAtom,
	filePreviewContextReadonlyAtom,
	inlineFilePreviewAtom,
	inlineFilePreviewContextReadonlyAtom,
	openInlineFilePreviewAtom,
	openReferencedFileAtom,
} from "./file-preview-atoms";

const source = "/docs/guide.md";
const referenced = "/docs/other.md";

describe("openReferencedFileAtom", () => {
	it("swaps the inline preview when that is the surface showing the source document", () => {
		const store = createStore();
		store.set(inlineFilePreviewAtom, { name: "guide.md", path: source });
		store.set(filePreviewAtom, { name: "shot.png", path: "/shots/shot.png" });

		store.set(openReferencedFileAtom, { from: source, path: referenced });

		expect(store.get(inlineFilePreviewContextReadonlyAtom)).toEqual({
			items: [{ name: "other.md", path: referenced }],
			index: 0,
		});
		expect(store.get(filePreviewContextReadonlyAtom)).toEqual({
			items: [{ name: "shot.png", path: "/shots/shot.png" }],
			index: 0,
		});
	});

	it("swaps the modal preview rather than opening a second surface", () => {
		const store = createStore();
		store.set(filePreviewAtom, { name: "guide.md", path: source });

		store.set(openReferencedFileAtom, { from: source, path: referenced });

		expect(store.get(filePreviewContextReadonlyAtom)).toEqual({
			items: [{ name: "other.md", path: referenced }],
			index: 0,
		});
		expect(store.get(inlineFilePreviewContextReadonlyAtom)).toBeNull();
	});

	it("opens the inline preview when neither surface is showing the source", () => {
		const store = createStore();

		store.set(openReferencedFileAtom, { from: source, path: referenced });

		expect(store.get(inlineFilePreviewContextReadonlyAtom)).toEqual({
			items: [{ name: "other.md", path: referenced }],
			index: 0,
		});
	});

	// The document a preview renders can be reopened after a reload; clearing the surface must
	// not turn a stale reference into a fresh preview of an unrelated file.
	it("keeps the source identity, so a reference from a different document does not hijack the surface", () => {
		const store = createStore();
		store.set(inlineFilePreviewAtom, { name: "guide.md", path: source });
		store.set(openInlineFilePreviewAtom, { name: "unrelated.md", path: "/docs/unrelated.md" });

		store.set(openReferencedFileAtom, { from: source, path: referenced });

		expect(store.get(inlineFilePreviewContextReadonlyAtom)).toEqual({
			items: [{ name: "other.md", path: referenced }],
			index: 0,
		});
	});
});
