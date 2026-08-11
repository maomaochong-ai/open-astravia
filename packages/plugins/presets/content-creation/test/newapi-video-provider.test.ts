import { describe, expect, it } from "vitest";
import { NewApiVideoProvider } from "../src/generation/newapi-video-provider";
import { base64Response, createSettings, jsonResponse, QueueNetwork } from "./provider-test-fixtures";

describe("NewApiVideoProvider", () => {
	it("hides a configured model while base URL or API key is missing", () => {
		const provider = new NewApiVideoProvider(new QueueNetwork([]), createSettings({ model: "video-model" }), {
			id: "custom-video",
			baseUrlSetting: "base",
			apiKeySetting: "key",
			modelSetting: "model",
		});
		expect(provider.listModels()).toEqual([]);
	});

	it("exposes the configured model and maps the video-generations protocol", async () => {
		const network = new QueueNetwork([
			jsonResponse({ id: "task-1", video_url: "https://cdn.example/result.mp4" }),
			base64Response("video-data", "video/mp4"),
		]);
		const provider = new NewApiVideoProvider(
			network,
			createSettings({ base: "https://newapi.test/v1", key: "secret", model: "video-model" }),
			{ id: "custom-video", baseUrlSetting: "base", apiKeySetting: "key", modelSetting: "model" },
		);

		expect(provider.listModels()).toMatchObject([{ modelId: "video-model", modes: [{ id: "text-to-video" }] }]);
		const result = await provider.generate({
			modeId: "text-to-video",
			providerId: "custom-video",
			modelId: "video-model",
			prompt: "A train through snow",
			duration: 10,
			resolution: "1080p",
			references: [],
		});

		expect(network.requests[0]).toMatchObject({
			url: "https://newapi.test/v1/video/generations",
			headers: { Authorization: "Bearer secret" },
		});
		expect(result).toMatchObject({
			kind: "video",
			source: { type: "inline", data: "video-data" },
			duration: 10,
		});
	});
});
