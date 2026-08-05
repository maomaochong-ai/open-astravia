import { describe, expect, it } from "vitest";
import {
	appendContentPromptReferences,
	contentPromptText,
	createContentPromptDocument,
	listContentPromptBindingIds,
} from "../src/node/prompt-document";

describe("structured prompt documents", () => {
	it("migrates legacy prompt text and bindings without parsing asset names from text", () => {
		const document = createContentPromptDocument({
			prompt: "Place @literal text beside the reference",
			inputs: [{ id: "binding", assetId: "asset", slotId: "promptReferences" }],
		});

		expect(document).toEqual({
			version: 1,
			segments: [
				{ type: "text", text: "Place @literal text beside the reference" },
				{ type: "asset-reference", bindingId: "binding" },
			],
		});
		expect(contentPromptText(document)).toBe("Place @literal text beside the reference");
		expect(listContentPromptBindingIds(document)).toEqual(["binding"]);
	});

	it("appends imported references as typed segments while preserving text order", () => {
		const document = appendContentPromptReferences(
			{ version: 1, segments: [{ type: "text", text: "Use " }] },
			["image-binding"],
		);

		expect(document.segments).toEqual([
			{ type: "text", text: "Use " },
			{ type: "asset-reference", bindingId: "image-binding" },
		]);
	});
});
