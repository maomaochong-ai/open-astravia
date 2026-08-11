import { DOMAIN_MEDIA_CAPABILITIES, MEDIA_PROTOCOL_VERSION, type MediaProviderJob } from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import type { VettaGatewayRequest, VettaGatewayResponse } from "../gateway/vetta-gateway-service.js";
import { JobManager } from "../jobs/job-manager.js";
import { MediaArtifactStore } from "./media-artifact-store.js";
import { MediaProviderRegistry } from "./media-provider-registry.js";
import { createVettaImageProvider } from "./vetta-image-provider.js";

vi.mock("../gateway/vetta-gateway-service.js", () => ({ requestVettaGateway: vi.fn() }));

const signal = new AbortController().signal;

function succeededJob(id = "provider-job-1"): MediaProviderJob {
	return {
		id,
		status: "succeeded",
		artifacts: [
			{
				id: "artifact-1",
				kind: "image",
				mimeType: "image/png",
				sizeBytes: 5,
				lifetime: "temporary",
			},
		],
	};
}

function createRegistry(): MediaProviderRegistry {
	return new MediaProviderRegistry(new JobManager());
}

describe("MediaProviderRegistry", () => {
	it("allows an empty provider registry", () => {
		expect(createRegistry().listProviders()).toEqual([]);
	});

	it("publishes cloned role-aware generation mode capabilities", () => {
		const registry = createRegistry();
		registry.registerProvider({
			descriptor: {
				id: "plugin:minimax-h3",
				ownerId: "comfyui-media-provider",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [
					{
						operation: "generate",
						kind: "video",
						modes: ["image-to-video"],
						modeCapabilities: [
							{
								mode: "image-to-video",
								inputs: [{ role: "firstFrame", kinds: ["image"], minItems: 0, maxItems: 1 }],
								minTotalItems: 1,
								aspectRatioPolicy: "input-derived",
							},
						],
					},
				],
			},
			submit: vi.fn(),
		});

		expect(registry.listProviders()[0]?.capabilities[0]).toMatchObject({
			modeCapabilities: [
				{
					mode: "image-to-video",
					inputs: [{ role: "firstFrame", kinds: ["image"] }],
					aspectRatioPolicy: "input-derived",
				},
			],
		});
	});

	it("omits undefined optional capability fields from provider list output", () => {
		const registry = createRegistry();
		registry.registerProvider({
			descriptor: {
				id: "plugin:minimax-h3",
				displayName: undefined,
				ownerId: "comfyui-media-provider",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [
					{
						operation: "generate",
						kind: "video",
						modes: ["text-to-video"],
						aspectRatios: undefined,
						resolutions: undefined,
						durationsSeconds: undefined,
						modeCapabilities: [
							{
								mode: "text-to-video",
								inputs: [],
								minTotalItems: undefined,
								maxTotalItems: undefined,
								aspectRatioPolicy: undefined,
								audioGeneration: "always",
							},
						],
					},
				],
			},
			submit: vi.fn(),
		});

		const providers = registry.listProviders();
		expect(() => DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.parseOutput(providers)).not.toThrow();
		expect(providers).toEqual(JSON.parse(JSON.stringify(providers)));
		expect(providers).toEqual([expect.not.objectContaining({ displayName: undefined })]);
		expect(providers[0]?.capabilities[0]).not.toEqual(
			expect.objectContaining({ aspectRatios: undefined, resolutions: undefined, durationsSeconds: undefined }),
		);
	});

	it("routes submissions through a registered host provider", async () => {
		const registry = createRegistry();
		const submit = vi.fn().mockResolvedValue(succeededJob());
		registry.registerProvider({
			descriptor: {
				id: "host:image",
				ownerId: "host",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ operation: "generate", kind: "image", modes: ["text-to-image"] }],
			},
			submit,
		});

		await expect(
			registry.submit(
				{
					ownerId: "consumer",
					providerId: "host:image",
					operation: "generate",
					kind: "image",
					mode: "text-to-image",
					prompt: "draw a fox",
					inputs: [],
				},
				signal,
			),
		).resolves.toMatchObject({
			domain: "media",
			operation: "generate",
			metadata: { providerId: "host:image" },
			status: "succeeded",
		});
		expect(submit).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: "draw a fox", inputs: [] }),
			expect.objectContaining({ ownerId: "consumer", signal: expect.any(AbortSignal) }),
		);
	});

	it("returns stable failures for missing and unsupported providers", async () => {
		const registry = createRegistry();
		registry.registerProvider({
			descriptor: {
				id: "host:image",
				ownerId: "host",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ operation: "generate", kind: "image", modes: ["text-to-image"] }],
			},
			submit: vi.fn(),
		});

		await expect(
			registry.submit(
				{
					ownerId: "consumer",
					providerId: "missing",
					operation: "generate",
					kind: "image",
					mode: "text-to-image",
					prompt: "draw",
					inputs: [],
				},
				signal,
			),
		).resolves.toMatchObject({ status: "failed", error: { code: "provider-unavailable" } });
		await expect(
			registry.submit(
				{
					ownerId: "consumer",
					providerId: "host:image",
					operation: "generate",
					kind: "image",
					mode: "image-to-image",
					prompt: "edit",
					inputs: [],
				},
				signal,
			),
		).resolves.toMatchObject({ status: "failed", error: { code: "operation-unsupported" } });
	});

	it("unregisters and aborts a provider through its lifecycle handle", async () => {
		const registry = createRegistry();
		const handle = registry.registerProvider({
			descriptor: {
				id: "host:video",
				ownerId: "host",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ operation: "generate", kind: "video", modes: ["text-to-video"] }],
			},
			submit: (_input, context) =>
				new Promise((resolve) => {
					context.signal.addEventListener("abort", () => resolve({ id: "job-video", status: "cancelled" }), {
						once: true,
					});
				}),
		});
		const pending = registry.submit(
			{
				ownerId: "consumer",
				providerId: "host:video",
				operation: "generate",
				kind: "video",
				mode: "text-to-video",
				prompt: "animate",
				inputs: [],
			},
			signal,
		);
		handle.dispose();

		await expect(pending).resolves.toMatchObject({ status: "failed", error: { code: "cancelled" } });
		expect(registry.listProviders()).toEqual([]);
	});

	it("resumes an existing host job through a replacement provider registration", async () => {
		const jobs = new JobManager();
		const registry = new MediaProviderRegistry(jobs);
		const first = registry.registerProvider({
			descriptor: {
				id: "plugin:video",
				ownerId: "provider-plugin",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ operation: "generate", kind: "video", modes: ["text-to-video"] }],
			},
			submit: vi.fn().mockResolvedValue({ id: "remote-job", status: "queued" }),
			getJob: vi.fn().mockResolvedValue({ id: "remote-job", status: "queued" }),
		});
		const job = await registry.submit(
			{
				ownerId: "consumer",
				providerId: "plugin:video",
				operation: "generate",
				kind: "video",
				mode: "text-to-video",
				prompt: "animate",
				inputs: [],
			},
			signal,
		);
		first.dispose();

		const replacementGetJob = vi.fn().mockResolvedValue(succeededJob("remote-job"));
		registry.registerProvider({
			descriptor: {
				id: "plugin:video",
				ownerId: "provider-plugin",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ operation: "generate", kind: "video", modes: ["text-to-video"] }],
			},
			submit: vi.fn(),
			getJob: replacementGetJob,
		});

		await expect(jobs.get("consumer", job.id, signal)).resolves.toMatchObject({ status: "succeeded" });
		expect(replacementGetJob).toHaveBeenCalledWith("remote-job", expect.objectContaining({ ownerId: "consumer" }));
	});
});

describe("Vetta image provider", () => {
	it("maps gateway authentication failures to unauthenticated media jobs", async () => {
		const provider = createVettaImageProvider(new MediaArtifactStore(), async () => ({
			ok: false,
			status: 401,
			code: -1,
			message: "Not signed in",
		}));

		await expect(
			provider.submit(
				{ operation: "generate", kind: "image", mode: "text-to-image", prompt: "draw a fox", inputs: [] },
				{ ownerId: "consumer", signal },
			),
		).resolves.toMatchObject({
			status: "failed",
			error: { code: "unauthenticated", message: "Not signed in", retryable: false },
		});
	});

	it("owns the gateway route and never accepts one from the caller", async () => {
		const requests: VettaGatewayRequest[] = [];
		const requestGateway = async <T>(request: VettaGatewayRequest): Promise<VettaGatewayResponse<T>> => {
			requests.push(request);
			return {
				ok: true,
				status: 200,
				code: 0,
				message: "",
				data: { data: "aW1hZ2U=", mime_type: "image/png", size: "1024x1024" } as T,
			};
		};
		const artifacts = new MediaArtifactStore();
		const provider = createVettaImageProvider(artifacts, requestGateway);

		const job = await provider.submit(
			{
				operation: "generate",
				kind: "image",
				mode: "text-to-image",
				prompt: "draw a fox",
				inputs: [],
			},
			{ ownerId: "consumer", signal },
		);
		expect(requests).toEqual([
			expect.objectContaining({ path: "images/generate", body: { prompt: "draw a fox", size: "1024x1024" } }),
		]);
		await artifacts.release("consumer", job.artifacts?.[0]?.id ?? "");
	});
});
