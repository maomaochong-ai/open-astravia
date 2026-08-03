import { describe, expect, it } from "vitest";
import { ReplicateProvider } from "../src/generation/replicate-provider";
import { base64Response, createSettings, jsonResponse, QueueNetwork } from "./provider-test-fixtures";

describe("ReplicateProvider", () => {
	it("maps a catalog image model to the Replicate prediction protocol", async () => {
		const network = new QueueNetwork([
			jsonResponse({ status: "succeeded", output: ["https://cdn.example/image.webp"] }),
			base64Response("image-data", "image/webp"),
		]);
		const provider = new ReplicateProvider(network, createSettings({ token: "r8-test" }), {
			apiTokenSetting: "token",
			baseUrl: "https://replicate.test/v1",
		});

		const result = await provider.generate({
			modeId: "text-to-image",
			providerId: "replicate",
			modelId: "bytedance/seedream-4.5",
			prompt: "A paper city",
			aspectRatio: "16:9",
			quality: "ultra",
			references: [],
		});

		expect(network.requests[0]).toMatchObject({
			url: "https://replicate.test/v1/models/bytedance/seedream-4.5/predictions",
			headers: { Authorization: "Bearer r8-test", Prefer: "wait" },
			body: {
				type: "json",
				value: { input: { prompt: "A paper city", aspect_ratio: "16:9", size: "4K" } },
			},
		});
		expect(result).toMatchObject({ kind: "image", data: "image-data", mimeType: "image/webp" });
	});

	it("maps video fields without exposing model conditions to the node", async () => {
		const network = new QueueNetwork([
			jsonResponse({ status: "succeeded", output: "https://cdn.example/video.mp4" }),
			base64Response("video-data", "video/mp4"),
		]);
		const provider = new ReplicateProvider(network, createSettings({ token: "r8-test" }), {
			apiTokenSetting: "token",
			baseUrl: "https://replicate.test/v1",
		});

		const result = await provider.generate({
			modeId: "text-to-video",
			providerId: "replicate",
			modelId: "google/veo-3.1",
			prompt: "Clouds crossing a valley",
			aspectRatio: "9:16",
			duration: 8,
			resolution: "1080p",
			references: [],
		});

		expect(network.requests[0]?.body).toEqual({
			type: "json",
			value: {
				input: {
					prompt: "Clouds crossing a valley",
					duration: 8,
					aspect_ratio: "9:16",
					generate_audio: true,
				},
			},
		});
		expect(result).toMatchObject({ kind: "video", data: "video-data", duration: 8, width: 1080, height: 1920 });
	});

	it("maps mixed image and video references into Kling O1 fields", async () => {
		const network = new QueueNetwork([
			jsonResponse({ status: "succeeded", output: "https://cdn.example/video.mp4" }),
			base64Response("video-data", "video/mp4"),
		]);
		const provider = new ReplicateProvider(network, createSettings({ token: "r8-test" }), {
			apiTokenSetting: "token",
			baseUrl: "https://replicate.test/v1",
		});

		await provider.generate({
			modeId: "video-to-video",
			providerId: "replicate",
			modelId: "kwaivgi/kling-o1",
			prompt: "Restyle the movement",
			references: [
				{ id: "image", slotId: "referenceImages", kind: "image", data: "image-data", mimeType: "image/png" },
				{ id: "video", slotId: "referenceVideo", kind: "video", data: "video-data", mimeType: "video/mp4" },
			],
		});

		expect(network.requests[0]?.body).toMatchObject({
			type: "json",
			value: {
				input: {
					reference_images: ["data:image/png;base64,image-data"],
					reference_video: "data:video/mp4;base64,video-data",
				},
			},
		});
	});
});
