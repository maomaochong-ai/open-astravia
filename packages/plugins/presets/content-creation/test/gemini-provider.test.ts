import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../src/generation/gemini-provider";
import { base64Response, createSettings, jsonResponse, QueueNetwork } from "./provider-test-fixtures";

describe("GeminiProvider", () => {
	it("uses Gemini generateContent for image models", async () => {
		const network = new QueueNetwork([
			jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { data: "png-data", mimeType: "image/png" } }] } }] }),
		]);
		const provider = new GeminiProvider(network, createSettings({ key: "google-test" }), {
			apiKeySetting: "key",
			baseUrl: "https://google.test/v1beta",
		});

		const result = await provider.generate({
			modeId: "text-to-image",
			providerId: "google",
			modelId: "google-official/gemini-2.5-flash-image",
			prompt: "A quiet studio",
			aspectRatio: "1:1",
			quality: "hd",
			references: [],
		});

		expect(network.requests[0]?.url).toBe(
			"https://google.test/v1beta/models/gemini-2.5-flash-image:generateContent",
		);
		expect(network.requests[0]?.headers).toEqual({ "x-goog-api-key": "google-test" });
		expect(result).toMatchObject({ kind: "image", data: "png-data", mimeType: "image/png" });
	});

	it("uses Gemini long-running operations for Veo models", async () => {
		const network = new QueueNetwork([
			jsonResponse({
				done: true,
				response: { generatedVideos: [{ video: { uri: "https://google.test/video", mimeType: "video/mp4" } }] },
			}),
			base64Response("video-data", "video/mp4"),
		]);
		const provider = new GeminiProvider(network, createSettings({ key: "google-test" }), {
			apiKeySetting: "key",
			baseUrl: "https://google.test/v1beta",
		});

		const result = await provider.generate({
			modeId: "text-to-video",
			providerId: "google",
			modelId: "google-official/veo-3.1-generate-preview",
			prompt: "A paper bird takes flight",
			aspectRatio: "16:9",
			duration: 7,
			resolution: "1080p",
			references: [],
		});

		expect(network.requests[0]?.body).toMatchObject({
			type: "json",
			value: { parameters: { durationSeconds: 6, resolution: "1080p" } },
		});
		expect(network.requests[1]?.headers).toEqual({ "x-goog-api-key": "google-test" });
		expect(result).toMatchObject({ kind: "video", data: "video-data", duration: 6 });
	});
});
