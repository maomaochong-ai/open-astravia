import { describe, expect, it } from "vitest";
import { createClipboardInsertionParts } from "./clipboard-message-parts";

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
