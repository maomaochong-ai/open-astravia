// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import {
	$getRoot,
	$isElementNode,
	$isTextNode,
	COPY_COMMAND,
	PASTE_COMMAND,
	createEditor,
	type LexicalEditor,
} from "lexical";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InputSegment } from "@shared/lib/input-tokens";
import { INPUT_EDITOR_NODES } from "../nodes";
import { $applySegments, $readSegments } from "../tokens/segments";
import { serializeInputSegmentsForClipboard } from "../clipboard-segments";

const harness = vi.hoisted(() => ({ editor: null as LexicalEditor | null }));

vi.mock("@lexical/react/LexicalComposerContext", () => ({
	useLexicalComposerContext: () => {
		if (!harness.editor) throw new Error("StructuredClipboardPlugin test editor is not ready");
		return [harness.editor];
	},
}));

const { StructuredClipboardPlugin } = await import("./StructuredClipboardPlugin");

function selectedEditorSegments(segments: readonly InputSegment[]): void {
	const editor = harness.editor;
	if (!editor) throw new Error("StructuredClipboardPlugin test editor is not ready");
	act(() => {
		editor.update(
			() => {
				$applySegments(segments);
				const paragraph = $getRoot().getFirstChild();
				if ($isElementNode(paragraph)) paragraph.select(0, paragraph.getChildrenSize());
			},
			{ discrete: true },
		);
	});
}

describe("StructuredClipboardPlugin", () => {
	beforeEach(() => {
		harness.editor = createEditor({ namespace: "structured-clipboard-test", nodes: INPUT_EDITOR_NODES, onError: (error) => { throw error; } });
	});

	it("copies and pastes tokens without falling back to path/name parsing", async () => {
		const source: InputSegment[] = [
			{ kind: "text", text: "12" },
			{ kind: "member", memberId: "member-1", handle: "flower", label: "Flower", meta: "研发" },
			{ kind: "text", text: " " },
			{ kind: "file", path: "C:/Users/admin/.vetta-dev/conversation/content-creation.json", isDirectory: false },
			{ kind: "text", text: " 1212.com" },
		];
		selectedEditorSegments(source);
		render(<StructuredClipboardPlugin />);
		await waitFor(() => expect(harness.editor?.dispatchCommand).toBeDefined());
		const clipboard = new Map<string, string>();
		const copyEvent = {
			clipboardData: { setData: (format: string, value: string) => clipboard.set(format, value) },
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;
		act(() => harness.editor?.dispatchCommand(COPY_COMMAND, copyEvent));
		expect(copyEvent.preventDefault).toHaveBeenCalledOnce();
		expect(clipboard.get("text/plain")).toBe("12 @flower @C:/Users/admin/.vetta-dev/conversation/content-creation.json 1212.com");

		selectedEditorSegments([]);
		const pasteEvent = {
			clipboardData: {
				getData: (format: string) => clipboard.get(format) ?? "",
			},
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;
		act(() => harness.editor?.dispatchCommand(PASTE_COMMAND, pasteEvent));
		await waitFor(() =>
			expect(harness.editor?.getEditorState().read(() => $readSegments())).toEqual(source),
		);
		expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
	});

	it("accepts an HTML-only paste from a standard clipboard implementation", async () => {
		const source: InputSegment[] = [{ kind: "skill", name: "review", alias: "审查" }];
		selectedEditorSegments([]);
		render(<StructuredClipboardPlugin />);
		const html = `<span data-vetta-input-segments="1" data-vetta-input-segments-payload="${encodeURIComponent(serializeInputSegmentsForClipboard(source))}">review</span>`;
		const pasteEvent = {
			clipboardData: { getData: (format: string) => (format === "text/html" ? html : "") },
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;
		act(() => harness.editor?.dispatchCommand(PASTE_COMMAND, pasteEvent));
		await waitFor(() => expect(harness.editor?.getEditorState().read(() => $readSegments())).toEqual(source));
	});

	it("copies only the selected portion of surrounding text while keeping a selected token atomic", async () => {
		const source: InputSegment[] = [
			{ kind: "text", text: "hello " },
			{ kind: "file", path: "C:/work/readme.md", isDirectory: false },
			{ kind: "text", text: " world" },
		];
		selectedEditorSegments(source);
		const editor = harness.editor;
		if (!editor) throw new Error("StructuredClipboardPlugin test editor is not ready");
		act(() => {
			editor.update(() => {
				const paragraph = $getRoot().getFirstChild();
				if (!$isElementNode(paragraph)) return;
				const textNode = paragraph.getFirstChild();
				if ($isTextNode(textNode)) textNode.select(1, 4);
			}, { discrete: true });
		});
		render(<StructuredClipboardPlugin />);
		const clipboard = new Map<string, string>();
		const copyEvent = {
			clipboardData: { setData: (format: string, value: string) => clipboard.set(format, value) },
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;
		act(() => editor.dispatchCommand(COPY_COMMAND, copyEvent));
		expect(clipboard.get("text/plain")).toBe("ell");
	});
});
