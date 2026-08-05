// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createContext, type ComponentProps, type ReactNode, useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentGeneratorComposer } from "./ContentGeneratorComposer";
import { ContentPromptEditor } from "./ContentPromptEditor";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

interface MockButtonProps extends ComponentProps<"button"> {
	size?: string;
	variant?: string;
}

vi.mock("@vetta/ui", () => ({
	Button: ({ children, size: _size, variant: _variant, ...props }: MockButtonProps) => (
		<button {...props}>{children}</button>
	),
	Popover: ({ children, open }: { children: ReactNode; open: boolean }) => (
		<PopoverOpenContext.Provider value={open}>{children}</PopoverOpenContext.Provider>
	),
	PopoverAnchor: ({ children }: { children: ReactNode }) => children,
	PopoverContent: ({ children }: { children: ReactNode }) =>
		useContext(PopoverOpenContext) ? <div data-testid="popover-content">{children}</div> : null,
}));

const PopoverOpenContext = createContext(false);

vi.mock("./ContentGenerationControls", () => ({
	ContentGenerationControls: () => null,
}));

vi.mock("./ContentReferenceInput", () => ({
	ContentReferenceInput: () => null,
}));

describe("node editor interaction boundary", () => {
	afterEach(cleanup);

	it("keeps prompt editor pointer events away from the React Flow pane", () => {
		const onPanePointerDown = vi.fn();
		render(
			<div onPointerDown={onPanePointerDown}>
				<ContentPromptEditor
					data={{ prompt: "" }}
					focusPromptRequest={0}
					mentionAssets={[]}
					onImportReferences={vi.fn()}
					onUpdate={vi.fn().mockResolvedValue(undefined)}
					referenceAssets={[]}
				/>
			</div>,
		);

		const editor = screen.getByRole("textbox");
		expect(editor.closest(".nopan")).not.toBeNull();

		fireEvent.pointerDown(editor);
		expect(onPanePointerDown).not.toHaveBeenCalled();
	});

	it("opens media suggestions after typing @ and renders image previews", () => {
		render(
			<ContentPromptEditor
				data={{ prompt: "" }}
				focusPromptRequest={0}
				mentionAssets={[
					{
						origin: "project",
						asset: {
							id: "mood",
							blobId: "mood",
							kind: "image",
							name: "Mood board",
							mimeType: "image/png",
							previewUrl: "vetta-media://mood",
							createdAt: "2026-01-01T00:00:00.000Z",
						},
					},
				]}
				onImportReferences={vi.fn()}
				onUpdate={vi.fn().mockResolvedValue(undefined)}
				referenceAssets={[]}
			/>,
		);

		const editor = screen.getByRole("textbox");
		editor.textContent = "@";
		const range = document.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		fireEvent.input(editor);

		expect(screen.getByTestId("popover-content")).toBeTruthy();
		const optionPreview = screen.getByRole("img", { name: "Mood board" });
		expect(optionPreview.getAttribute("src")).toBe("vetta-media://mood");
		fireEvent.click(screen.getByText("Mood board"));
		expect(editor.querySelector("img")?.getAttribute("src")).toBe("vetta-media://mood");
	});

	it("keeps generator prompt pointer events away from the React Flow pane", () => {
		const onPanePointerDown = vi.fn();
		render(
			<div onPointerDown={onPanePointerDown}>
				<ContentGeneratorComposer
					connectedAssets={[]}
					connectedPrompts={[]}
					data={{ prompt: "" }}
					hasGenerationError={false}
					kind="image-generator"
					models={[]}
					onImportReferences={vi.fn()}
					onRunNode={vi.fn().mockResolvedValue(undefined)}
					onUpdate={vi.fn().mockResolvedValue(undefined)}
					referenceAssets={[]}
					status="idle"
				/>
			</div>,
		);

		const editor = screen.getByRole("textbox");
		expect(editor.closest(".nopan")).not.toBeNull();

		fireEvent.pointerDown(editor);
		expect(onPanePointerDown).not.toHaveBeenCalled();
	});
});
