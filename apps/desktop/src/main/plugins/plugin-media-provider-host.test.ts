import type { MediaProviderJob } from "@vetta/capability-sdk";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import type { DesktopMediaRuntime } from "../capabilities/media-providers.js";
import type { MediaProviderRegistration } from "../media-generation/media-provider-registry.js";
import { PluginMediaProviderHost, type PluginMediaProviderHostDependencies } from "./plugin-media-provider-host.js";

function plugin(permissions: InstalledPlugin["permissions"] = ["media.provider.register"]): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "esm",
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions,
		grantedPermissions: permissions,
		allowedNetworkHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "system",
		trustLevel: "official",
		rootPath: "C:/plugins/demo",
	};
}

function sender(id: number) {
	return { id, send: vi.fn() } as unknown as WebContents;
}

function createHarness(installed = plugin()) {
	let registration: MediaProviderRegistration | undefined;
	const disposals: Array<ReturnType<typeof vi.fn>> = [];
	const providers = {
		registerProvider: vi.fn((value: MediaProviderRegistration) => {
			registration = value;
			const dispose = vi.fn();
			disposals.push(dispose);
			return { dispose };
		}),
	};
	const artifacts = {
		resolveInputFile: vi.fn().mockResolvedValue({
			path: "C:/plugins/demo/generated.png",
			mimeType: "image/png",
			sizeBytes: 4,
		}),
		putFile: vi.fn().mockResolvedValue({
			id: "artifact-1",
			kind: "image",
			mimeType: "image/png",
			sizeBytes: 4,
			lifetime: "temporary",
		}),
		release: vi.fn(),
	};
	const runtime = { providers, artifacts } as unknown as DesktopMediaRuntime;
	const dependencies: PluginMediaProviderHostDependencies = {
		listPlugins: () => [installed],
		getMediaRuntime: () => runtime,
		createRequestId: () => "request-1",
		fetch: vi.fn(),
		openAsBlob: vi.fn(),
	};
	return {
		host: new PluginMediaProviderHost(dependencies),
		providers,
		artifacts,
		disposals,
		getRegistration: () => registration,
	};
}

const providerRegistration = {
	id: "image",
	handlerId: "handler-1",
	activationId: "activation-1",
	capabilities: [],
};

describe("PluginMediaProviderHost", () => {
	it("replaces a provider and ignores stale activation cleanup", () => {
		const harness = createHarness();
		const contents = sender(1);

		harness.host.register(contents, "demo", providerRegistration);
		harness.host.register(contents, "demo", { ...providerRegistration, activationId: "activation-2" });
		expect(harness.disposals[0]).toHaveBeenCalledOnce();

		harness.host.unregister(contents, "demo", "image", "activation-1");
		expect(harness.disposals[1]).not.toHaveBeenCalled();
		harness.host.unregister(contents, "demo", "image", "activation-2");
		expect(harness.disposals[1]).toHaveBeenCalledOnce();
	});

	it("accepts invocation responses only from the registering sender", async () => {
		const harness = createHarness();
		const owner = sender(1);
		harness.host.register(owner, "demo", providerRegistration);
		const registration = harness.getRegistration();
		if (!registration) throw new Error("Provider was not registered");
		const controller = new AbortController();
		const invocation = registration.submit(
			{ inputs: [] } as unknown as Parameters<MediaProviderRegistration["submit"]>[0],
			{ ownerId: "owner", signal: controller.signal },
		);

		harness.host.respond(sender(2), "request-1", { value: { id: "spoofed" } });
		let settled = false;
		void invocation.finally(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		const result: MediaProviderJob = { id: "job-1", status: "succeeded", artifacts: [] };
		harness.host.respond(owner, "request-1", { value: result });
		await expect(invocation).resolves.toEqual(result);
	});

	it("rejects registration without the declared and granted permission", () => {
		const harness = createHarness(plugin([]));

		expect(() => harness.host.register(sender(1), "demo", providerRegistration)).toThrow(
			"Plugin permission denied: media.provider.register",
		);
	});

	it("maps plugin blob artifacts to generic storage blob inputs", async () => {
		const harness = createHarness(plugin(["media.provider.register", "storage.read"]));
		const contents = sender(1);
		harness.host.register(contents, "demo", providerRegistration);
		const registration = harness.getRegistration();
		if (!registration) throw new Error("Provider was not registered");

		const invocation = registration.submit(
			{ inputs: [] } as unknown as Parameters<MediaProviderRegistration["submit"]>[0],
			{ ownerId: "consumer", signal: new AbortController().signal },
		);
		harness.host.respond(contents, "request-1", {
			value: {
				id: "job-1",
				status: "succeeded",
				artifacts: [
					{
						kind: "image",
						mimeType: "image/png",
						source: { type: "plugin-blob", blobId: "generated" },
					},
				],
			},
		});

		await expect(invocation).resolves.toMatchObject({ artifacts: [{ id: "artifact-1" }] });
		expect(harness.artifacts.resolveInputFile).toHaveBeenCalledWith({
			kind: "image",
			mimeType: "image/png",
			source: { type: "storage-blob", namespace: "demo", id: "generated" },
		});
	});
});
