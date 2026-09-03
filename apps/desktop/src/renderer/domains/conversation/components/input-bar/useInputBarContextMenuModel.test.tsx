// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { MouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInputBarContextMenuModel } from "./useInputBarContextMenuModel";

const mocks = vi.hoisted(() => ({
	focusInputEditor: vi.fn(),
	insertClipboardMessage: vi.fn(),
	pasteUserMessage: vi.fn(),
	recordInputImagesAdded: vi.fn(),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./editor/inputEditorHandle", () => ({
	focusInputEditor: mocks.focusInputEditor,
	insertConnectorToken: vi.fn(),
	insertFileToken: vi.fn(),
	insertImageToken: vi.fn(),
	insertPlainText: vi.fn(),
	insertSceneToken: vi.fn(),
	insertSkillToken: vi.fn(),
	readSelectionText: vi.fn(() => ""),
	removeImageToken: vi.fn(),
	removeSelection: vi.fn(),
}));
vi.mock("./editor/clipboard-message", () => ({ insertClipboardMessage: mocks.insertClipboardMessage }));
vi.mock("./editor/persistImages", () => ({
	persistBase64Images: vi.fn(),
	persistImageFiles: vi.fn(),
}));
vi.mock("@shared/lib/app-monitor-events", () => ({
	recordInputFilesAdded: vi.fn(),
	recordInputImagesAdded: mocks.recordInputImagesAdded,
}));

describe("useInputBarContextMenuModel", () => {
	beforeEach(() => {
		mocks.focusInputEditor.mockClear();
		mocks.insertClipboardMessage.mockClear();
		mocks.pasteUserMessage.mockReset();
		mocks.recordInputImagesAdded.mockClear();
		mocks.pasteUserMessage.mockResolvedValue({
			text: "before @C:/old/copied.png after",
			images: [{ path: "C:/persisted/copied.png", format: "png", sizeBytes: 3 }],
		});
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				clipboard: {
					pasteUserMessage: mocks.pasteUserMessage,
				},
			},
		});
	});

	it("restores rich user-message images when Paste is chosen", async () => {
		const { result } = renderHook(() =>
			useInputBarContextMenuModel({ activeRuntimeId: "runtime-1", hasSession: true }),
		);
		act(() => {
			result.current.onContextMenu({
				preventDefault: vi.fn(),
				clientX: 10,
				clientY: 10,
			} as unknown as MouseEvent<HTMLDivElement>);
		});
		await waitFor(() => expect(result.current.contextMenu?.canPaste).toBe(true));
		mocks.focusInputEditor.mockClear();

		act(() => result.current.contextMenu?.onPaste());

		await waitFor(() => expect(mocks.pasteUserMessage).toHaveBeenCalledWith("runtime-1"));
		expect(mocks.recordInputImagesAdded).toHaveBeenCalledWith("paste", [
			{ path: "C:/persisted/copied.png", format: "png", sizeBytes: 3 },
		]);
		expect(mocks.insertClipboardMessage).toHaveBeenCalledWith("before @C:/old/copied.png after", [
			"C:/persisted/copied.png",
		]);
		expect(mocks.focusInputEditor).toHaveBeenCalledOnce();
	});
});
