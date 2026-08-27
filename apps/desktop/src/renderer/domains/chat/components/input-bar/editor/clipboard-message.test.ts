import { describe, expect, it, vi } from "vitest";
import { createClipboardInsertionParts } from "./clipboard-message-parts";

const mocks = vi.hoisted(() => ({ insertInputParts: vi.fn() }));

vi.mock("./inputEditorHandle", () => ({ insertInputParts: mocks.insertInputParts }));

const { insertClipboardMessage } = await import("./clipboard-message");

describe("createClipboardInsertionParts", () => {
	it("replaces copied image paths in place and appends images without old tokens", () => {
		expect(
			createClipboardInsertionParts("before @C:/old/first.png middle @C:/old/second.png after", [
				"C:/new/first.png",
				"C:/new/second.png",
				"C:/new/extra.png",
			]),
		).toEqual([
			{ kind: "text", text: "before " },
			{ kind: "image", path: "C:/new/first.png" },
			{ kind: "text", text: "middle " },
			{ kind: "image", path: "C:/new/second.png" },
			{ kind: "text", text: "after" },
			{ kind: "image", path: "C:/new/extra.png" },
		]);
	});
});

describe("insertClipboardMessage", () => {
	it("submits the complete text-image sequence as one editor batch", () => {
		insertClipboardMessage("before @C:/old.png after", ["C:/new.png", "C:/extra.png"]);

		expect(mocks.insertInputParts).toHaveBeenCalledOnce();
		expect(mocks.insertInputParts).toHaveBeenCalledWith([
			{ kind: "text", text: "before " },
			{ kind: "image", path: "C:/new.png" },
			{ kind: "text", text: "after" },
			{ kind: "image", path: "C:/extra.png" },
		]);
	});
});
