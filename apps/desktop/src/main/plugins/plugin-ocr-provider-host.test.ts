import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { OcrProviderRegistry } from "../ocr/ocr-provider-registry.js";
import { PluginOcrProviderHost, type PluginOcrProviderHostDependencies } from "./plugin-ocr-provider-host.js";

const registration = {
	id: "cloud",
	displayName: "Cloud OCR",
	protocolVersion: 1 as const,
	processing: "remote" as const,
	execution: "async" as const,
	input: {
		kinds: ["image" as const],
		mimeTypes: ["image/png"],
		acceptsInlineBytes: false,
		acceptsUrl: false,
		maxItemsPerRequest: 8,
	},
	output: {
		granularities: ["text" as const, "word" as const],
		supportsConfidence: true,
		supportsPolygon: true,
		supportsLanguageDetection: true,
	},
	network: { allowedHosts: ["ocr.example.com"] },
	handlerId: "cloud:handler",
	activationId: "activation-1",
};

function plugin(granted = true): InstalledPlugin {
	return {
		id: "demo.ocr",
		enabled: true,
		permissions: ["ai.ocr.provider.register", "network.fetch"],
		grantedPermissions: granted ? ["ai.ocr.provider.register", "network.fetch"] : [],
		allowedNetworkHosts: ["ocr.example.com"],
	} as InstalledPlugin;
}

function harness(granted = true) {
	const registry = new OcrProviderRegistry();
	const sender = { id: 42, send: vi.fn() };
	const dependencies: PluginOcrProviderHostDependencies = {
		listPlugins: () => [plugin(granted)],
		createRequestId: () => "request-1",
		fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
		openAsBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })) as never,
		getRegistry: () => registry,
	};
	return { host: new PluginOcrProviderHost(dependencies), registry, sender, dependencies };
}

describe("PluginOcrProviderHost", () => {
	it("qualifies plugin providers and keeps consumer inputs opaque", async () => {
		const { host, registry, sender } = harness();
		host.register(sender as never, "demo.ocr", registration);
		const provider = registry.get("plugin:demo.ocr:cloud");
		expect(provider?.descriptor.ownerId).toBe("demo.ocr");
		const promise = provider?.recognize(
			{ inputs: [{ id: "page-1", mimeType: "image/png" }] },
			{
				signal: new AbortController().signal,
				invocationId: "outer-call",
				getInputPath: async () => "C:\\books\\page.png",
				reportProgress: () => undefined,
			},
		);
		expect(sender.send).toHaveBeenCalledWith(
			"vetta:plugins:ocr-provider-request",
			expect.objectContaining({ input: { inputs: [{ id: "page-1", mimeType: "image/png" }] } }),
		);
		expect(JSON.stringify(sender.send.mock.calls)).not.toContain("C:\\\\books");
		host.respond(sender as never, "request-1", {
			value: { protocolVersion: 1, items: [{ id: "page-1", status: "ok", text: "墨" }] },
		});
		await expect(promise).resolves.toEqual({
			protocolVersion: 1,
			providerId: "plugin:demo.ocr:cloud",
			items: [{ id: "page-1", status: "ok", text: "墨" }],
		});
	});

	it("requires the dedicated provider permission", () => {
		const { host, sender } = harness(false);
		expect(() => host.register(sender as never, "demo.ocr", registration)).toThrow(
			"Plugin permission denied: ai.ocr.provider.register",
		);
	});

	it("streams upload through the host and rejects undeclared targets", async () => {
		const { host, registry, sender, dependencies } = harness();
		host.register(sender as never, "demo.ocr", registration);
		const provider = registry.get("plugin:demo.ocr:cloud");
		const recognize = provider?.recognize(
			{ inputs: [{ id: "page-1", mimeType: "image/png" }] },
			{
				signal: new AbortController().signal,
				invocationId: "outer-call",
				getInputPath: async () => "C:\\books\\page.png",
				reportProgress: () => undefined,
			},
		);
		await expect(
			host.uploadInput(sender as never, "request-1", "page-1", {
				url: "https://other.example.com/upload",
				fieldName: "image",
			}),
		).rejects.toThrow("not allowed");
		await expect(
			host.uploadInput(sender as never, "request-1", "page-1", {
				url: "https://ocr.example.com/upload",
				fieldName: "image",
			}),
		).resolves.toMatchObject({ ok: true, status: 200, body: { ok: true } });
		expect(dependencies.fetch).toHaveBeenCalledOnce();
		host.respond(sender as never, "request-1", {
			value: { protocolVersion: 1, items: [{ id: "page-1", status: "ok" }] },
		});
		await recognize;
	});

	it("forwards progress and propagates cancellation to the plugin renderer", async () => {
		const { host, registry, sender } = harness();
		host.register(sender as never, "demo.ocr", registration);
		const progress = vi.fn();
		const controller = new AbortController();
		const promise = registry.get("plugin:demo.ocr:cloud")?.recognize(
			{ inputs: [{ id: "page-1", mimeType: "image/png" }] },
			{
				signal: controller.signal,
				invocationId: "outer-call",
				getInputPath: async () => "C:\\books\\page.png",
				reportProgress: progress,
			},
		);
		host.progress(sender as never, "request-1", { phase: "processing", completed: 1, total: 1, itemId: "page-1" });
		expect(progress).toHaveBeenCalledWith({ phase: "processing", completed: 1, total: 1, itemId: "page-1" });
		controller.abort();
		await expect(promise).rejects.toThrow("cancelled");
		expect(sender.send).toHaveBeenCalledWith("vetta:plugins:ocr-provider-cancel", { requestId: "request-1" });
	});
});
