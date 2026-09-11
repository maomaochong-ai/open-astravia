// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ editor: null as LexicalEditor | null }));

vi.mock("@lexical/react/LexicalComposerContext", () => ({
	useLexicalComposerContext: () => {
		if (!harness.editor) throw new Error("TriggerPlugin test editor is not ready");
		return [harness.editor];
	},
}));

const { TriggerPlugin } = await import("./TriggerPlugin");

function replaceEditorText(text: string): void {
	const editor = harness.editor;
	if (!editor) throw new Error("TriggerPlugin test editor is not ready");
	act(() => {
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const paragraph = $createParagraphNode();
				const textNode = $createTextNode(text);
				paragraph.append(textNode);
				root.append(paragraph);
				textNode.selectEnd();
			},
			{ discrete: true },
		);
	});
}

describe("TriggerPlugin", () => {
	beforeEach(() => {
		harness.editor = createEditor({
			namespace: "trigger-plugin-test",
			onError: (error) => {
				throw error;
			},
		});
	});

	it("reports a complete @ query pasted after existing text in one editor update", async () => {
		const onTriggerChange = vi.fn();
		render(<TriggerPlugin onTriggerChange={onTriggerChange} />);

		replaceEditorText("请让@research");

		await waitFor(() =>
			expect(onTriggerChange).toHaveBeenLastCalledWith({ kind: "at", query: "research", length: 9 }),
		);
	});

	it("clears the panel for non-trigger text and reports the same query after it is pasted again", async () => {
		const onTriggerChange = vi.fn();
		render(<TriggerPlugin onTriggerChange={onTriggerChange} />);

		replaceEditorText("已有描述/skill");
		await waitFor(() => expect(onTriggerChange).toHaveBeenLastCalledWith({ kind: "slash", query: "skill", length: 6 }));

		replaceEditorText("已有描述");
		await waitFor(() => expect(onTriggerChange).toHaveBeenLastCalledWith(null));

		replaceEditorText("已有描述/skill");
		await waitFor(() => expect(onTriggerChange).toHaveBeenLastCalledWith({ kind: "slash", query: "skill", length: 6 }));
	});

	it("does not open a panel when an email address is pasted", () => {
		const onTriggerChange = vi.fn();
		render(<TriggerPlugin onTriggerChange={onTriggerChange} />);

		replaceEditorText("联系 support@example.com");

		expect(onTriggerChange).not.toHaveBeenCalled();
	});
});
