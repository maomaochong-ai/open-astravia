// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import type { LexicalCommand } from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handler: null as ((event: ClipboardEvent) => boolean) | null,
	insertClipboardMessage: vi.fn(),
	persistImageFiles: vi.fn(
		async (_files: readonly File[], _sessionId: string | null, _source: string) => [
			"C:/persisted/one.png",
			"C:/persisted/two.png",
		],
	),
}));

vi.mock("@lexical/react/LexicalComposerContext", () => ({
	useLexicalComposerContext: () => [
		{
			registerCommand: (
				_command: LexicalCommand<ClipboardEvent>,
				handler: (event: ClipboardEvent) => boolean,
			) => {
				mocks.handler = handler;
				return vi.fn();
			},
		},
	],
}));
vi.mock("../clipboard-message", () => ({ insertClipboardMessage: mocks.insertClipboardMessage }));
vi.mock("../inputEditorHandle", () => ({ insertImageToken: vi.fn() }));
vi.mock("../persistImages", () => ({ persistImageFiles: mocks.persistImageFiles }));

const { PasteImagePlugin } = await import("./PasteImagePlugin");

describe("PasteImagePlugin", () => {
	beforeEach(() => {
		mocks.handler = null;
		mocks.insertClipboardMessage.mockClear();
		mocks.persistImageFiles.mockClear();
	});

	it("persists all images from a copied Vetta message and restores its text-image structure", async () => {
		render(<PasteImagePlugin />);
		const preventDefault = vi.fn();
		const event = {
			clipboardData: {
				items: [],
				getData: (format: string) =>
					format === "text/html"
						? `<div data-vetta-user-message="1"><img data-vetta-clipboard-image src="data:image/png;base64,AQID"><img data-vetta-clipboard-image src="data:image/png;base64,BAUG"></div>`
						: "before @C:/old/one.png after @C:/old/two.png",
			},
			preventDefault,
		} as unknown as ClipboardEvent;

		expect(mocks.handler?.(event)).toBe(true);
		expect(preventDefault).toHaveBeenCalledOnce();
		await waitFor(() => expect(mocks.persistImageFiles).toHaveBeenCalledOnce());
		expect(mocks.persistImageFiles.mock.calls[0]?.[0]).toHaveLength(2);
		expect(mocks.persistImageFiles).toHaveBeenCalledWith(expect.any(Array), null, "paste");
		expect(mocks.insertClipboardMessage).toHaveBeenCalledWith(
			"before @C:/old/one.png after @C:/old/two.png",
			["C:/persisted/one.png", "C:/persisted/two.png"],
		);
	});
});
