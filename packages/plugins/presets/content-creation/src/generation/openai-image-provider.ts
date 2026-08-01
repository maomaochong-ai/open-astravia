import type { PluginNetworkApi, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import type {
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	GeneratedContent,
} from "./types";

interface OpenAiImageProviderOptions {
	id: string;
	baseUrl?: string;
	baseUrlSetting?: string;
	apiKeySetting: string;
	modelSetting: string;
	defaultModel?: string;
}

interface ImageResponseItem {
	b64_json?: string;
	url?: string;
}

interface ImageResponse {
	data?: ImageResponseItem[];
}

const DEFAULT_ASPECT_RATIOS = ["1:1", "16:9", "9:16"] as const;

function readSetting(settings: PluginSettingsApi, key: string): string {
	const value = settings.get<unknown>(key);
	return typeof value === "string" ? value.trim() : "";
}

function sniffImageMimeType(base64: string): string {
	if (base64.startsWith("iVBORw0KGgo")) return "image/png";
	if (base64.startsWith("/9j/")) return "image/jpeg";
	if (base64.startsWith("UklGR")) return "image/webp";
	return "image/png";
}

function sizeForAspectRatio(aspectRatio: string | undefined): string {
	if (aspectRatio === "16:9" || aspectRatio === "4:3") return "1536x1024";
	if (aspectRatio === "9:16" || aspectRatio === "3:4") return "1024x1536";
	return "1024x1024";
}

export class OpenAiImageProvider implements ContentProviderAdapter {
	readonly id: string;

	constructor(
		private readonly network: PluginNetworkApi,
		private readonly settings: PluginSettingsApi,
		private readonly options: OpenAiImageProviderOptions,
	) {
		this.id = options.id;
	}

	listModels(): readonly ContentModelDescriptor[] {
		const modelId = readSetting(this.settings, this.options.modelSetting) || this.options.defaultModel;
		if (!modelId) return [];
		return [
			{
				providerId: this.id,
				modelId,
				capabilities: ["text-to-image"],
				aspectRatios: DEFAULT_ASPECT_RATIOS,
			},
		];
	}

	async generate(request: ContentGenerationRequest): Promise<GeneratedContent> {
		if (request.capability !== "text-to-image") {
			throw new Error(`unsupported OpenAI-compatible capability: ${request.capability}`);
		}
		const apiKey = readSetting(this.settings, this.options.apiKeySetting);
		const configuredBaseUrl = this.options.baseUrlSetting
			? readSetting(this.settings, this.options.baseUrlSetting)
			: this.options.baseUrl;
		const baseUrl = configuredBaseUrl?.replace(/\/+$/, "");
		if (!apiKey) throw new Error(`content provider API key is not configured: ${this.id}`);
		if (!baseUrl) throw new Error(`content provider base URL is not configured: ${this.id}`);

		const response = await this.network.request<ImageResponse>({
			url: `${baseUrl}/images/generations`,
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: {
				type: "json",
				value: {
					model: request.modelId,
					prompt: request.prompt,
					n: 1,
					size: sizeForAspectRatio(request.aspectRatio),
				},
			},
			responseType: "json",
			timeoutMs: 300_000,
		});
		if (!response.ok) throw new Error(`content provider returned HTTP ${response.status}`);
		const item = response.body.data?.[0];
		if (!item) throw new Error("content provider response is missing data[0]");
		if (item.b64_json) {
			return { kind: "image", data: item.b64_json, mimeType: sniffImageMimeType(item.b64_json) };
		}
		if (!item.url) throw new Error("content provider response is missing image data");
		const imageUrl = new URL(item.url, `${baseUrl}/`).toString();
		const download = await this.network.request<string>({
			url: imageUrl,
			headers: imageUrl.startsWith(`${baseUrl}/`) ? { Authorization: `Bearer ${apiKey}` } : undefined,
			responseType: "base64",
			timeoutMs: 120_000,
		});
		if (!download.ok) throw new Error(`content image download returned HTTP ${download.status}`);
		const header = download.headers["content-type"];
		const mimeType = header?.startsWith("image/") ? header.split(";")[0]! : sniffImageMimeType(download.body);
		return { kind: "image", data: download.body, mimeType };
	}
}
