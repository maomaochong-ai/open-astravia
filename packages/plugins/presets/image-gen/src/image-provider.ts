import type {
	PluginContext,
	PluginGatewayApi,
	PluginNetworkApi,
	PluginSettingsApi,
	PluginStoredBlob,
} from "@vetta-org/plugin-sdk";

/**
 * 两条出图链路（ADR-0056）：
 *
 * 1. **Vetta 网关（默认）**——插件不感知模型、不持有 key，只发 prompt/size 打
 *    `images/generate|edit`。模型选择、provider 形态适配、尺寸白名单与计费都在服务端。
 * 2. **自定义 API（高级选项）**——直连 OpenAI 兼容渠道，用户自带 key、不消耗订阅额度。
 *    保留它是为了私有部署与内网场景：Vetta API 不可达时图像功能不该整个消失。
 *
 * 直连模式只支持 OpenAI 兼容形态，agnes-ai 专用分支已删除——服务端 adapter 已经覆盖
 * 那类聚合站，插件再养第二套完整 adapter 就是长期双维护。
 */

interface CustomConfig {
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

/** 服务端图像端点的响应体（业务信封已由宿主拆开）。 */
interface GatewayImageResult {
	data: string;
	mime_type: string;
	size: string;
}

const DEFAULT_SIZE = "1024x1024";

/** 服务端会二次校验并归一非法尺寸，这里只是少打一次必然被改写的请求。 */
const GATEWAY_PATHS = {
	generate: "images/generate",
	edit: "images/edit",
} as const;

/**
 * 网关调用失败。带上业务错误码，让 UI 能把「配额用尽 / 档位不含图像生成」
 * 渲染成订阅引导，而不是一句红色报错。
 */
export class ImageGatewayError extends Error {
	readonly code: number;
	readonly status: number;

	constructor(message: string, code: number, status: number) {
		super(message);
		this.name = "ImageGatewayError";
		this.code = code;
		this.status = status;
	}
}

/** 与服务端 errcode 对应；UI 据此切换引导文案。 */
export const IMAGE_ERROR_CODES = {
	SUBSCRIPTION_INACTIVE: 40302,
	MODEL_NOT_IN_PLAN: 40303,
	QUOTA_EXHAUSTED: 42902,
	SERVICE_DISABLED: 40301,
	NOT_CONFIGURED: 50302,
} as const;

function readSetting(settings: PluginSettingsApi, key: string): string {
	const value = settings.get<unknown>(key);
	return typeof value === "string" ? value.trim() : "";
}

/**
 * 是否走自定义直连。未显式选过 `mode` 时按存量配置推断——插件只能读设置、不能写，
 * 无法在升级时把老值搬到新键上，只能在读取侧兼容。
 *
 * 老的 `provider=custom` 用户三个字段（baseUrl/customApiKey/model）键名未变，
 * 直接沿用；老的 openai / agnes-ai 用户则迁到网关：他们的 key 本就是为了绕过
 * 「没有官方图像服务」而填的，现在有了就不该再让他们自付。
 */
export function usesCustomApi(settings: PluginSettingsApi): boolean {
	const mode = readSetting(settings, "mode");
	if (mode === "custom") return true;
	if (mode === "vetta") return false;
	return readSetting(settings, "provider") === "custom";
}

function resolveCustomConfig(settings: PluginSettingsApi): CustomConfig {
	const apiKey = readSetting(settings, "customApiKey");
	const baseUrl = readSetting(settings, "baseUrl").replace(/\/+$/, "");
	const model = readSetting(settings, "model");
	if (!apiKey) throw new Error("Custom image provider requires an API key");
	if (!baseUrl) throw new Error("Custom image provider requires a base URL");
	if (!model) throw new Error("Custom image provider requires a model");
	return { baseUrl, apiKey, model };
}

/** 自定义直连缺必填项时为 true；网关模式恒为 false（无需任何本地配置）。 */
export function customApiIncomplete(settings: PluginSettingsApi): boolean {
	if (!usesCustomApi(settings)) return false;
	return (
		readSetting(settings, "customApiKey") === "" ||
		readSetting(settings, "baseUrl") === "" ||
		readSetting(settings, "model") === ""
	);
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

// --- Vetta 网关 ---

async function requestGateway(
	gateway: PluginGatewayApi,
	path: string,
	body: Record<string, unknown>,
): Promise<PluginStoredBlob> {
	const response = await gateway.request<GatewayImageResult>({
		path,
		method: "POST",
		body,
		timeoutMs: 300_000,
	});
	if (!response.ok || !response.data?.data) {
		throw new ImageGatewayError(
			response.message || `Image gateway returned HTTP ${response.status}`,
			response.code,
			response.status,
		);
	}
	return { data: response.data.data, mimeType: response.data.mime_type || sniffMime(response.data.data) };
}

// --- 自定义直连（OpenAI 兼容） ---

async function requestCustom(
	network: PluginNetworkApi,
	config: CustomConfig,
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
	config: CustomConfig,
): Promise<PluginStoredBlob> {
	if (item.b64_json) {
		return { data: item.b64_json, mimeType: sniffMime(item.b64_json) };
	}
	if (!item.url) throw new Error("Image response is missing b64_json and url");
	const absolute = /^https?:\/\//i.test(item.url);
	const url = absolute ? item.url : new URL(item.url, `${config.baseUrl}/`).toString();
	const response = await network.request<string>({
		url,
		// 相对地址挂在渠道自己域下、可能要鉴权；绝对地址不带 key，避免漏给第三方 CDN
		headers: absolute ? undefined : { Authorization: `Bearer ${config.apiKey}` },
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

// --- 对外入口 ---

/** 网关不可用（第三方插件加载或宿主未挂载）时的兜底：直连模式没开就没有出路。 */
function requireGateway(ctx: PluginContext): PluginGatewayApi {
	if (!ctx.gateway) {
		throw new Error("Vetta image gateway is unavailable; enable a custom API in plugin settings");
	}
	return ctx.gateway;
}

export async function generateImage(
	ctx: PluginContext,
	input: { prompt: string; size?: string },
): Promise<PluginStoredBlob> {
	const size = input.size?.trim() || DEFAULT_SIZE;
	if (!usesCustomApi(ctx.settings)) {
		return requestGateway(requireGateway(ctx), GATEWAY_PATHS.generate, { prompt: input.prompt, size });
	}
	const config = resolveCustomConfig(ctx.settings);
	const item = await requestCustom(ctx.network, config, "images/generations", {
		type: "json",
		value: { model: config.model, prompt: input.prompt, n: 1, size },
	});
	return extractBytes(ctx.network, item, config);
}

export async function editImage(
	ctx: PluginContext,
	input: { prompt: string; source: PluginStoredBlob; size?: string },
): Promise<PluginStoredBlob> {
	const size = input.size?.trim() || DEFAULT_SIZE;
	if (!usesCustomApi(ctx.settings)) {
		// 源图走 JSON base64 上行：远程服务摸不到用户磁盘，本地文件只能由插件读完再传
		return requestGateway(requireGateway(ctx), GATEWAY_PATHS.edit, {
			prompt: input.prompt,
			size,
			image: input.source.data,
			mime_type: input.source.mimeType,
		});
	}
	const config = resolveCustomConfig(ctx.settings);
	const item = await requestCustom(ctx.network, config, "images/edits", {
		type: "multipart",
		fields: { model: config.model, prompt: input.prompt, n: "1", size },
		files: [
			{
				fieldName: "image",
				fileName: `source.${extensionForMime(input.source.mimeType)}`,
				mimeType: input.source.mimeType,
				data: input.source.data,
			},
		],
	});
	return extractBytes(ctx.network, item, config);
}
