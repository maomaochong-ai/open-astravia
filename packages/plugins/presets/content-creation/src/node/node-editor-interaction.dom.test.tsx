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
	PopoverTrigger: ({ children }: { children: ReactNode }) => children,
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

vi.mock("../prompt-optimization/PromptOptimizationControl", () => ({
	PromptOptimizationControl: () => null,
}));

vi.mock("../prompt-optimization/usePromptOptimizationModels", () => ({
	usePromptOptimizationModels: () => ({
		models: [],
		selectedModelKey: "",
		setSelectedModelKey: () => undefined,
		isLoadingModels: false,
	}),
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
		const panel = editor.closest<HTMLElement>("[data-node-editor-panel]");
		expect(panel?.classList.contains("select-none")).toBe(true);
		expect(panel?.classList.contains("nopan")).toBe(false);
		expect(editor.classList.contains("select-text")).toBe(true);
		expect(editor.classList.contains("nopan")).toBe(true);
		expect(editor.classList.contains("max-h-72")).toBe(true);
		expect(editor.classList.contains("overflow-y-auto")).toBe(true);

		fireEvent.pointerDown(editor);
		expect(onPanePointerDown).not.toHaveBeenCalled();

		const panelHint = screen.getByText("nodeEditor.prompt.mention.inlineHint");
		fireEvent.pointerDown(panelHint);
		expect(onPanePointerDown).toHaveBeenCalledOnce();
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

	it("preserves an active prompt draft across stale parent refreshes", () => {
		const onUpdate = vi.fn().mockResolvedValue(undefined);
		const onImportReferences = vi.fn();
		const view = render(
			<ContentPromptEditor
				data={{ prompt: "" }}
				focusPromptRequest={0}
				mentionAssets={[]}
				onImportReferences={onImportReferences}
				onUpdate={onUpdate}
				referenceAssets={[]}
			/>,
		);

		const editor = screen.getByRole("textbox");
		editor.focus();
		expect(document.activeElement).toBe(editor);
		editor.textContent = "Local prompt draft";
		fireEvent.input(editor);

		view.rerender(
			<ContentPromptEditor
				data={{ prompt: "" }}
				focusPromptRequest={0}
				mentionAssets={[]}
				onImportReferences={onImportReferences}
				onUpdate={onUpdate}
				referenceAssets={[]}
			/>,
		);

		expect(editor.textContent).toBe("Local prompt draft");
		fireEvent.blur(editor);
		expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Local prompt draft" }));
	});

	it("keeps generator prompt pointer events away from the React Flow pane", () => {
		const onPanePointerDown = vi.fn();
		render(
			<div onPointerDown={onPanePointerDown}>
				<ContentGeneratorComposer
					connectedAssets={[]}
					connectedPrompts={[]}
					data={{ prompt: "" }}
					kind="image-generator"
					mentionAssets={[]}
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
		expect(editor.classList.contains("nopan")).toBe(true);
		expect(editor.classList.contains("max-h-52")).toBe(true);
		expect(editor.classList.contains("overflow-y-auto")).toBe(true);

		fireEvent.pointerDown(editor);
		expect(onPanePointerDown).not.toHaveBeenCalled();
	});

	it("offers prompts and compatible media from the same generator @ menu", () => {
		const onUpdate = vi.fn().mockResolvedValue(undefined);
		render(
			<ContentGeneratorComposer
				connectedAssets={[]}
				connectedPrompts={[
					{
						nodeId: "prompt-node",
						label: "Storyboard prompt",
						prompt: "A cinematic scene",
						references: [],
					},
				]}
				data={{ prompt: "Draft" }}
				kind="image-generator"
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
				models={[
					{
						providerId: "test",
						modelId: "image-model",
						displayName: "Image model",
						outputKind: "image",
						aspectRatios: ["1:1"],
						modes: [
							{
								id: "text-to-image",
								inputs: [{ id: "images", accepts: ["image"], minItems: 0, maxItems: 1 }],
							},
						],
					},
				]}
				onImportReferences={vi.fn()}
				onRunNode={vi.fn().mockResolvedValue(undefined)}
				onUpdate={onUpdate}
				referenceAssets={[]}
				status="idle"
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

		expect(screen.getByText("Storyboard prompt")).toBeTruthy();
		expect(screen.getByText("Mood board")).toBeTruthy();
		fireEvent.click(screen.getByText("Mood board"));
		expect(editor.querySelector("img")?.getAttribute("src")).toBe("vetta-media://mood");
		expect(onUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				inputs: expect.arrayContaining([
					expect.objectContaining({ assetId: "mood", slotId: "images" }),
				]),
				promptDocument: expect.objectContaining({
					segments: expect.arrayContaining([
						expect.objectContaining({ type: "asset-reference" }),
					]),
				}),
			}),
		);
	});
});
