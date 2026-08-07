import { MEDIA_PROTOCOL_VERSION, type MediaProviderJob } from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import type { VettaGatewayRequest, VettaGatewayResponse } from "../gateway/vetta-gateway-service.js";
import { MediaArtifactStore } from "./media-artifact-store.js";
import { MediaProviderRegistry } from "./media-provider-registry.js";
import { createVettaImageProvider } from "./vetta-image-provider.js";

vi.mock("../gateway/vetta-gateway-service.js", () => ({ requestVettaGateway: vi.fn() }));

const signal = new AbortController().signal;

function succeededJob(id = "job-1"): MediaProviderJob {
	return {
		id,
		status: "succeeded",
		artifacts: [{ id: "artifact-1", kind: "image", mimeType: "image/png", sizeBytes: 5 }],
	};
}

describe("MediaProviderRegistry", () => {
	it("allows an empty provider registry", () => {
		expect(new MediaProviderRegistry().listProviders()).toEqual([]);
	});

	it("routes jobs through a registered host provider", async () => {
		const registry = new MediaProviderRegistry();
		const createJob = vi.fn().mockResolvedValue(succeededJob());
		registry.registerProvider({
			descriptor: {
				id: "host:image",
				ownerId: "host",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ kind: "image", modes: ["text-to-image"] }],
			},
			createJob,
		});

		await expect(
			registry.createJob(
				{ providerId: "host:image", kind: "image", mode: "text-to-image", prompt: "draw a fox" },
				signal,
			),
		).resolves.toMatchObject({ providerId: "host:image", id: "job-1", status: "succeeded" });
		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: "draw a fox", references: [] }),
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("returns stable failures for missing and unsupported providers", async () => {
		const registry = new MediaProviderRegistry();
		registry.registerProvider({
			descriptor: {
				id: "host:image",
				ownerId: "host",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ kind: "image", modes: ["text-to-image"] }],
			},
			createJob: vi.fn(),
		});

		await expect(
			registry.createJob({ providerId: "missing", kind: "image", mode: "text-to-image", prompt: "draw" }, signal),
		).resolves.toMatchObject({ status: "failed", error: { code: "provider-unavailable" } });
		await expect(
			registry.createJob(
				{ providerId: "host:image", kind: "image", mode: "image-to-image", prompt: "edit" },
				signal,
			),
		).resolves.toMatchObject({ status: "failed", error: { code: "operation-unsupported" } });
	});

	it("unregisters and aborts a provider through its lifecycle handle", async () => {
		const registry = new MediaProviderRegistry();
		const handle = registry.registerProvider({
			descriptor: {
				id: "host:video",
				ownerId: "host",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [{ kind: "video", modes: ["text-to-video"] }],
			},
			createJob: (_input, context) =>
				new Promise((resolve) => {
					context.signal.addEventListener("abort", () => resolve({ id: "job-video", status: "cancelled" }), {
						once: true,
					});
				}),
		});
		const pending = registry.createJob(
			{ providerId: "host:video", kind: "video", mode: "text-to-video", prompt: "animate" },
			signal,
		);
		handle.dispose();

		await expect(pending).resolves.toMatchObject({ status: "failed", error: { code: "cancelled" } });
		expect(registry.listProviders()).toEqual([]);
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
			provider.createJob({ kind: "image", mode: "text-to-image", prompt: "draw a fox", references: [] }, { signal }),
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

		const job = await provider.createJob(
			{
				kind: "image",
				mode: "text-to-image",
				prompt: "draw a fox",
				references: [],
			},
			{ signal },
		);
		expect(requests).toEqual([
			expect.objectContaining({ path: "images/generate", body: { prompt: "draw a fox", size: "1024x1024" } }),
		]);
		await artifacts.release(job.artifacts?.[0]?.id ?? "");
	});
});
