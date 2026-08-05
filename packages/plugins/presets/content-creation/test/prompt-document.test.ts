import { describe, expect, it } from "vitest";
import {
	appendContentPromptReferences,
	contentPromptText,
	contentPromptDocumentsEqual,
	createContentPromptDocument,
	listContentPromptBindingIds,
	listContentPromptSourceNodeIds,
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

	it("migrates a legacy selected prompt into a structured source token", () => {
		const document = createContentPromptDocument(
			{ prompt: "Ignored legacy local text", promptSourceNodeId: "prompt-node" },
			{ includeInputBindings: false },
		);

		expect(document.segments).toEqual([
			{ type: "prompt-reference", sourceNodeId: "prompt-node" },
		]);
		expect(listContentPromptSourceNodeIds(document)).toEqual(["prompt-node"]);
		expect(contentPromptDocumentsEqual(document, structuredClone(document))).toBe(true);
	});
});
