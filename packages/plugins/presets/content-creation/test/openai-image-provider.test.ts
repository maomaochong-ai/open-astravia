import type {
	Disposable,
	PluginNetworkApi,
	PluginNetworkRequest,
	PluginNetworkResponse,
	PluginSettingsApi,
} from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { OpenAiImageProvider } from "../src/generation/openai-image-provider";

const generationContext = { readReference: async () => ({ data: "", mimeType: "application/octet-stream" }) };

describe("OpenAiImageProvider", () => {
	it("maps a generation request to the real OpenAI-compatible endpoint", async () => {
		const network = new QueueNetwork([
			{
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {},
				body: { data: [{ b64_json: "iVBORw0KGgoAAA" }] },
			},
		]);
		const provider = new OpenAiImageProvider(network, createSettings({ apiKey: "sk-test", model: "image-model" }), {
			id: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiKeySetting: "apiKey",
			modelSetting: "model",
		});

		const result = await provider.generate({
			modeId: "text-to-image",
			providerId: "openai",
			modelId: "image-model",
			prompt: "A paper city",
			aspectRatio: "16:9",
			references: [],
		}, generationContext);

		expect(result).toEqual({
			kind: "image",
			source: { type: "inline", data: "iVBORw0KGgoAAA" },
			mimeType: "image/png",
		});
		expect(network.requests[0]).toMatchObject({
			url: "https://api.openai.com/v1/images/generations",
			method: "POST",
			headers: { Authorization: "Bearer sk-test" },
			body: {
				type: "json",
				value: { model: "image-model", prompt: "A paper city", n: 1, size: "1536x1024" },
			},
		});
	});

	it("fails before the network call when the key is missing", async () => {
		const network = new QueueNetwork([]);
		const provider = new OpenAiImageProvider(network, createSettings({ model: "image-model" }), {
			id: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiKeySetting: "apiKey",
			modelSetting: "model",
		});

		await expect(
			provider.generate({
				modeId: "text-to-image",
				providerId: "openai",
				modelId: "image-model",
				prompt: "A paper city",
				references: [],
			}, generationContext),
		).rejects.toThrow("API key is not configured");
		expect(network.requests).toHaveLength(0);
	});
});

function createSettings(values: Record<string, unknown>): PluginSettingsApi {
	return {
		get: <T = unknown>(key: string) => values[key] as T | undefined,
		getAll: () => ({ ...values }),
		onChange: (): Disposable => ({ dispose: () => undefined }),
	};
}

class QueueNetwork implements PluginNetworkApi {
	readonly requests: PluginNetworkRequest[] = [];

	constructor(private readonly responses: PluginNetworkResponse<unknown>[]) {}

	async request<T = unknown>(request: PluginNetworkRequest): Promise<PluginNetworkResponse<T>> {
		this.requests.push(request);
		const response = this.responses.shift();
		if (!response) throw new Error("unexpected network request");
		return response as PluginNetworkResponse<T>;
	}
}
