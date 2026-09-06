import type {
	PluginNetworkApi,
	PluginSettingsApi,
	PluginStoredBlob,
} from "@astravia-org/plugin-sdk";

type ImageProvider = "openai" | "agnes-ai" | "custom";

interface ImageConfig {
	provider: ImageProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
}

interface ImageResponseItem {
	b64_json?: string;
	url?: string;
}

interface ImageResponse {
	data?: ImageResponseItem[];
}

const DEFAULT_SIZE = "1024x1024";
const PROVIDER_PRESETS = {
	openai: {
		baseUrl: "https://api.openai.com/v1",
		modelKey: "openaiModel",
		apiKeyKey: "openaiApiKey",
	},
	"agnes-ai": {
		baseUrl: "https://apihub.agnes-ai.com/v1",
		modelKey: "agnesModel",
		apiKeyKey: "agnesApiKey",
	},
} as const;

function readSetting(settings: PluginSettingsApi, key: string): string {
	const value = settings.get<unknown>(key);
	return typeof value === "string" ? value.trim() : "";
}

function resolveConfig(settings: PluginSettingsApi): ImageConfig {
	const configuredProvider = readSetting(settings, "provider");
	const provider: ImageProvider =
		configuredProvider === "agnes-ai"
			? "agnes-ai"
			: configuredProvider === "custom"
				? "custom"
				: "openai";
	if (provider === "custom") {
		const apiKey = readSetting(settings, "customApiKey");
		const baseUrl = readSetting(settings, "baseUrl").replace(/\/+$/, "");
		const model = readSetting(settings, "model");
		if (!apiKey) throw new Error("Custom image provider requires an API key");
		if (!baseUrl) throw new Error("Custom image provider requires a base URL");
		if (!model) throw new Error("Custom image provider requires a model");
		return { provider, baseUrl, apiKey, model };
	}
	const preset = PROVIDER_PRESETS[provider];
	const apiKey = readSetting(settings, preset.apiKeyKey);
	const model = readSetting(settings, preset.modelKey);
	if (!apiKey) throw new Error("Image provider API key is not configured");
	if (!model) throw new Error("Image model is not configured");
	return { provider, baseUrl: preset.baseUrl, apiKey, model };
}

function extensionForMime(mimeType: string): string {
	if (mimeType.includes("jpeg")) return "jpg";
	if (mimeType.includes("webp")) return "webp";
	if (mimeType.includes("gif")) return "gif";
	return "png";
}

function sniffMime(base64: string): string {
	const prefix = base64.slice(0, 24);
	if (prefix.startsWith("iVBORw0KGgo")) return "image/png";
	if (prefix.startsWith("/9j/")) return "image/jpeg";
	if (prefix.startsWith("UklGR")) return "image/webp";
	if (prefix.startsWith("R0lGOD")) return "image/gif";
	return "image/png";
}

async function requestImage(
	network: PluginNetworkApi,
	config: ImageConfig,
	path: string,
	body:
		| { type: "json"; value: Record<string, unknown> }
		| {
				type: "multipart";
				fields: Record<string, string>;
				files: Array<{
					fieldName: string;
					fileName: string;
					mimeType: string;
					data: string;
				}>;
		  },
): Promise<ImageResponseItem> {
	const response = await network.request<ImageResponse>({
		url: `${config.baseUrl}/${path}`,
		method: "POST",
		headers: { Authorization: `Bearer ${config.apiKey}` },
		body,
		responseType: "json",
		timeoutMs: 300_000,
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Image provider returned HTTP ${response.status}`);
	}
	const item = response.body.data?.[0];
	if (!item) throw new Error("Image provider response is missing data[0]");
	return item;
}

async function extractBytes(
	network: PluginNetworkApi,
	item: ImageResponseItem,
	config: ImageConfig,
): Promise<PluginStoredBlob> {
	if (item.b64_json) {
		return { data: item.b64_json, mimeType: sniffMime(item.b64_json) };
	}
	if (!item.url) throw new Error("Image response is missing b64_json and url");
	const absolute = /^https?:\/\//i.test(item.url);
	const url = absolute ? item.url : new URL(item.url, `${config.baseUrl}/`).toString();
	const response = await network.request<string>({
		url,
		...(absolute ? {} : { headers: { Authorization: `Bearer ${config.apiKey}` } }),
		responseType: "base64",
		timeoutMs: 120_000,
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Image download returned HTTP ${response.status}`);
	}
	const header = response.headers["content-type"];
	const mimeType = header?.startsWith("image/") ? header.split(";")[0]! : sniffMime(response.body);
	return { data: response.body, mimeType };
}

export async function generateImage(
	network: PluginNetworkApi,
	settings: PluginSettingsApi,
	input: { prompt: string; size?: string },
): Promise<PluginStoredBlob> {
	const config = resolveConfig(settings);
	const size = input.size?.trim() || DEFAULT_SIZE;
	const value =
		config.provider === "agnes-ai"
			? { model: config.model, prompt: input.prompt, size, return_base64: true }
			: { model: config.model, prompt: input.prompt, n: 1, size };
	const item = await requestImage(network, config, "images/generations", {
		type: "json",
		value,
	});
	return extractBytes(network, item, config);
}

export async function editImage(
	network: PluginNetworkApi,
	settings: PluginSettingsApi,
	input: { prompt: string; source: PluginStoredBlob; size?: string },
): Promise<PluginStoredBlob> {
	const config = resolveConfig(settings);
	const size = input.size?.trim() || DEFAULT_SIZE;
	const body =
		config.provider === "agnes-ai"
			? {
					type: "json" as const,
					value: {
						model: config.model,
						prompt: input.prompt,
						size,
						extra_body: {
							image: [`data:${input.source.mimeType};base64,${input.source.data}`],
							response_format: "b64_json",
						},
					},
				}
			: {
					type: "multipart" as const,
					fields: { model: config.model, prompt: input.prompt, n: "1", size },
					files: [
						{
							fieldName: "image",
							fileName: `source.${extensionForMime(input.source.mimeType)}`,
							mimeType: input.source.mimeType,
							data: input.source.data,
						},
					],
				};
	const path = config.provider === "agnes-ai" ? "images/generations" : "images/edits";
	const item = await requestImage(network, config, path, body);
	return extractBytes(network, item, config);
}
