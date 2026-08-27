// @vitest-environment jsdom

import { $createParagraphNode, $getRoot, createEditor } from "lexical";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertInputParts, setInputEditor } from "./inputEditorHandle";
import { ImageTokenNode } from "./nodes";

describe("insertInputParts", () => {
	afterEach(() => setInputEditor(null));

	it("inserts an ordered text-image sequence with one editor update", async () => {
		const editor = createEditor({
			namespace: "input-editor-test",
			nodes: [ImageTokenNode],
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				const paragraph = $createParagraphNode();
				$getRoot().append(paragraph);
				paragraph.selectEnd();
			},
			{ discrete: true },
		);
		setInputEditor(editor);
		const update = vi.spyOn(editor, "update");
		const committed = new Promise<void>((resolve) => {
			const unregister = editor.registerUpdateListener(() => {
				unregister();
				resolve();
			});
		});

		insertInputParts([
			{ kind: "text", text: "before " },
			{ kind: "image", path: "C:/one.png" },
			{ kind: "text", text: "middle " },
			{ kind: "image", path: "C:/two.png" },
		]);
		await committed;

		expect(update).toHaveBeenCalledOnce();
		expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
			"before @C:/one.png middle @C:/two.png ",
		);
	});
});
