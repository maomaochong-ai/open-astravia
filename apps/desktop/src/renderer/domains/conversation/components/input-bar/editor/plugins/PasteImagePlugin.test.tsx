// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import type { LexicalCommand } from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handler: null as ((event: ClipboardEvent) => boolean) | null,
	insertClipboardMessage: vi.fn(),
	persistBase64Images: vi.fn(
		async (_images: readonly unknown[], _sessionId: string | null, _source: string) => [
			"C:/persisted/one.png",
			"C:/persisted/two.png",
		],
	),
	persistImageFiles: vi.fn(
		async (_files: readonly File[], _sessionId: string | null, _source: string) => [
			"C:/persisted/one.png",
			"C:/persisted/two.png",
		],
	),
	pasteUserMessage: vi.fn(),
	recordInputImagesAdded: vi.fn(),
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
vi.mock("../persistImages", () => ({
	persistBase64Images: mocks.persistBase64Images,
	persistImageFiles: mocks.persistImageFiles,
}));
vi.mock("@shared/lib/app-monitor-events", () => ({
	recordInputImagesAdded: mocks.recordInputImagesAdded,
}));

const { PasteImagePlugin } = await import("./PasteImagePlugin");

describe("PasteImagePlugin", () => {
	beforeEach(() => {
		mocks.handler = null;
		mocks.insertClipboardMessage.mockClear();
		mocks.persistBase64Images.mockClear();
		mocks.persistImageFiles.mockClear();
		mocks.pasteUserMessage.mockReset();
		mocks.recordInputImagesAdded.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { clipboard: { pasteUserMessage: mocks.pasteUserMessage } },
		});
	});

	it("persists a native rich clipboard entry in main and restores its text-image structure", async () => {
		render(<PasteImagePlugin />);
		const preventDefault = vi.fn();
		const duplicatedNativeFile = new File([new Uint8Array([9])], "native.png", { type: "image/png" });
		mocks.pasteUserMessage.mockResolvedValue({
			text: "before @C:/old/one.png after @C:/old/two.png",
			images: [
				{ path: "C:/persisted/one.png", format: "png", sizeBytes: 3, width: 10, height: 20 },
				{ path: "C:/persisted/two.png", format: "png", sizeBytes: 3, width: 30, height: 40 },
			],
		});
		const getData = vi.fn(() => {
			throw new Error("synchronous HTML clipboard read should not run");
		});
		const event = {
			clipboardData: {
				items: [
					{
						kind: "file",
						type: "image/png",
						getAsFile: () => duplicatedNativeFile,
					},
				],
				getData,
			},
			preventDefault,
		} as unknown as ClipboardEvent;

		expect(mocks.handler?.(event)).toBe(true);
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(getData).not.toHaveBeenCalled();
		await waitFor(() => expect(mocks.pasteUserMessage).toHaveBeenCalledWith("draft"));
		expect(mocks.persistBase64Images).not.toHaveBeenCalled();
		expect(mocks.persistImageFiles).not.toHaveBeenCalled();
		expect(mocks.recordInputImagesAdded).toHaveBeenCalledWith("paste", [
			{ path: "C:/persisted/one.png", format: "png", sizeBytes: 3, width: 10, height: 20 },
			{ path: "C:/persisted/two.png", format: "png", sizeBytes: 3, width: 30, height: 40 },
		]);
		expect(mocks.insertClipboardMessage).toHaveBeenCalledWith(
			"before @C:/old/one.png after @C:/old/two.png",
			["C:/persisted/one.png", "C:/persisted/two.png"],
		);
	});

	it("persists non-Vetta image files through the fallback and inserts all paths as one batch", async () => {
		render(<PasteImagePlugin />);
		const preventDefault = vi.fn();
		const nativeFile = new File([new Uint8Array([9])], "native.png", { type: "image/png" });
		mocks.pasteUserMessage.mockResolvedValue(null);
		const event = {
			clipboardData: {
				items: [{ kind: "file", type: "image/png", getAsFile: () => nativeFile }],
				getData: vi.fn(),
			},
			preventDefault,
		} as unknown as ClipboardEvent;

		expect(mocks.handler?.(event)).toBe(true);
		await waitFor(() => expect(mocks.persistImageFiles).toHaveBeenCalledWith([nativeFile], null, "paste"));
		await waitFor(() =>
			expect(mocks.insertClipboardMessage).toHaveBeenCalledWith("", [
				"C:/persisted/one.png",
				"C:/persisted/two.png",
			]),
		);
		expect(mocks.persistBase64Images).not.toHaveBeenCalled();
	});
});
