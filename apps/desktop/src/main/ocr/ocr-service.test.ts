import type { OcrProviderDescriptor, OcrResult } from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import { OcrProviderRegistry } from "./ocr-provider-registry.js";
import { OcrService } from "./ocr-service.js";

const localDescriptor: OcrProviderDescriptor = {
	id: "desktop-app:ppocrv5",
	displayName: "PP-OCRv5",
	ownerId: "desktop-app",
	protocolVersion: 1,
	processing: "local",
	execution: "sync",
	status: "ready",
	input: { kinds: ["image"], mimeTypes: ["image/png"], acceptsInlineBytes: false, acceptsUrl: true },
	output: {
		granularities: ["text"],
		supportsConfidence: true,
		supportsPolygon: false,
		supportsLanguageDetection: false,
	},
};

function result(providerId: string, ids: readonly string[]): OcrResult {
	return { protocolVersion: 1, providerId, items: ids.map((id) => ({ id, status: "ok", text: id })) };
}

describe("OcrService", () => {
	it("uses the built-in provider by default and preserves batch order", async () => {
		const registry = new OcrProviderRegistry();
		const recognize = vi.fn(async (request: { inputs: readonly { id: string }[] }) =>
			result(
				localDescriptor.id,
				request.inputs.map(({ id }) => id),
			),
		);
		registry.registerProvider({ descriptor: localDescriptor, recognize });
		const service = new OcrService({
			registry,
			readConfiguration: () => undefined,
			createInvocationId: () => "call-1",
		});
		const getInputPath = vi.fn(async (input) =>
			input.source.type === "workspace-file" ? input.source.path : input.source.id,
		);
		const output = await service.recognize(
			{
				ownerId: "plugin.demo",
				inputs: [
					{ id: "page", mimeType: "image/png", source: { type: "workspace-file", path: "one.png" } },
					{ id: "page", mimeType: "image/png", source: { type: "workspace-file", path: "two.png" } },
				],
			},
			{ signal: new AbortController().signal, inputResolver: { getInputPath } },
		);
		expect(output.items.map(({ id }) => id)).toEqual(["page", "page-2"]);
		expect(recognize).toHaveBeenCalledOnce();
	});

	it("does not silently use a remote provider while confirmation is required", async () => {
		const registry = new OcrProviderRegistry();
		registry.registerProvider({
			descriptor: { ...localDescriptor, id: "plugin:remote:cloud", ownerId: "remote", processing: "remote" },
			recognize: async () => result("plugin:remote:cloud", ["input-1"]),
		});
		const service = new OcrService({
			registry,
			readConfiguration: () => ({ defaultProviderId: "plugin:remote:cloud", remoteProviderPolicy: "ask" }),
		});
		await expect(
			service.recognize(
				{ ownerId: "plugin.demo", inputs: [{ source: { type: "workspace-file", path: "one.png" } }] },
				{ signal: new AbortController().signal, inputResolver: { getInputPath: async () => "one.png" } },
			),
		).rejects.toThrow("requires confirmation");
	});

	it("rejects unsupported output detail before invoking the provider", async () => {
		const registry = new OcrProviderRegistry();
		const recognize = vi.fn(async () => result(localDescriptor.id, ["input-1"]));
		registry.registerProvider({ descriptor: localDescriptor, recognize });
		const service = new OcrService({ registry, readConfiguration: () => undefined });
		await expect(
			service.recognize(
				{
					ownerId: "plugin.demo",
					granularity: "word",
					inputs: [{ mimeType: "image/png", source: { type: "workspace-file", path: "one.png" } }],
				},
				{ signal: new AbortController().signal, inputResolver: { getInputPath: async () => "one.png" } },
			),
		).rejects.toThrow("does not support word");
		expect(recognize).not.toHaveBeenCalled();
	});
});
