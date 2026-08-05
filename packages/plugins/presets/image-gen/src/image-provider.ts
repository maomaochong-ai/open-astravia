import type { PluginContext, PluginGatewayApi, PluginStoredBlob } from "@vetta-org/plugin-sdk";

/**
 * 出图一律走 Vetta 网关（ADR-0056）。
 *
 * 插件不感知模型、不持有任何 key，只把 prompt/size 发给服务端的
 * `images/generate|edit`；模型选择、provider 形态适配（含改图协议差异）、
 * 尺寸白名单与按次计费都在服务端，管理员在 admin 配置。
 *
 * 这里没有「自定义 API」逃生舱：一旦允许用户自带 key，插件就得重新养一套
 * provider 适配——而改图形态各家不同（官方 multipart / 聚合站 images[].image_url），
 * 那套适配已经在服务端存在，客户端再养一份就是长期双维护。
 */

interface GatewayImageResult {
	data: string;
	mime_type: string;
	size: string;
}

const DEFAULT_SIZE = "1024x1024";

const GATEWAY_PATHS = {
	generate: "images/generate",
	edit: "images/edit",
} as const;

/**
 * 网关调用失败。带上业务错误码，让调用方能把「配额用尽 / 档位不含图像生成」
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

/** 与服务端 errcode 对应；调用方据此切换引导文案。 */
export const IMAGE_ERROR_CODES = {
	SUBSCRIPTION_INACTIVE: 40302,
	MODEL_NOT_IN_PLAN: 40303,
	QUOTA_EXHAUSTED: 42902,
	SERVICE_DISABLED: 40301,
	NOT_CONFIGURED: 50302,
} as const;

function sniffMime(base64: string): string {
	const prefix = base64.slice(0, 24);
	if (prefix.startsWith("iVBORw0KGgo")) return "image/png";
	if (prefix.startsWith("/9j/")) return "image/jpeg";
	if (prefix.startsWith("UklGR")) return "image/webp";
	if (prefix.startsWith("R0lGOD")) return "image/gif";
	return "image/png";
}

/**
 * 网关不可用（第三方插件加载或宿主未挂载 ctx.gateway）时没有兜底路径，
 * 直接报错而不是静默降级——静默降级会让用户以为功能坏了却看不到原因。
 */
function requireGateway(ctx: PluginContext): PluginGatewayApi {
	if (!ctx.gateway) {
		throw new Error("Vetta image gateway is unavailable in this host");
	}
	return ctx.gateway;
}

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
	return {
		data: response.data.data,
		mimeType: response.data.mime_type || sniffMime(response.data.data),
	};
}

export async function generateImage(
	ctx: PluginContext,
	input: { prompt: string; size?: string },
): Promise<PluginStoredBlob> {
	return requestGateway(requireGateway(ctx), GATEWAY_PATHS.generate, {
		prompt: input.prompt,
		size: input.size?.trim() || DEFAULT_SIZE,
	});
}

export async function editImage(
	ctx: PluginContext,
	input: { prompt: string; source: PluginStoredBlob; size?: string },
): Promise<PluginStoredBlob> {
	// 源图走 JSON base64 上行：远程服务摸不到用户磁盘，本地文件只能由插件读完再传
	return requestGateway(requireGateway(ctx), GATEWAY_PATHS.edit, {
		prompt: input.prompt,
		size: input.size?.trim() || DEFAULT_SIZE,
		image: input.source.data,
		mime_type: input.source.mimeType,
	});
}
