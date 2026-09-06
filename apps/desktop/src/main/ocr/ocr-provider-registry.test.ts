import { describe, expect, it } from "vitest";
import { OcrProviderRegistry, qualifyOcrProviderInputs } from "./ocr-provider-registry.js";

const descriptor = {
	id: "desktop-app:ppocrv5",
	displayName: "PP-OCRv5",
	ownerId: "desktop-app",
	protocolVersion: 1 as const,
	processing: "local" as const,
	execution: "sync" as const,
	status: "ready" as const,
	input: { kinds: ["image" as const], mimeTypes: ["image/png"], acceptsInlineBytes: false, acceptsUrl: true },
	output: {
		granularities: ["text" as const, "line" as const],
		supportsConfidence: true,
		supportsPolygon: false,
		supportsLanguageDetection: false,
	},
};

describe("OcrProviderRegistry", () => {
	it("registers, lists and disposes providers", () => {
		const registry = new OcrProviderRegistry();
		const handle = registry.registerProvider({
			descriptor,
			recognize: async () => ({ protocolVersion: 1, providerId: descriptor.id, items: [] }),
		});
		expect(registry.listProviders()).toEqual([descriptor]);
		handle.dispose();
		expect(registry.listProviders()).toEqual([]);
	});

	it("qualifies missing input ids without changing caller source", () => {
		const request = { ownerId: "plugin", inputs: [{ source: { type: "workspace-file" as const, path: "a.png" } }] };
		const result = qualifyOcrProviderInputs(request, "plugin");
		expect(result.inputs[0].id).toBe("input-1");
		expect(request.inputs[0]).not.toHaveProperty("id");
	});
});
