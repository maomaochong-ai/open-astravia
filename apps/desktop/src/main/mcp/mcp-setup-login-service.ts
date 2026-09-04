import type { McpContent, McpJsonValue, McpToolCallResult } from "@vetta/runtime-mcp";
import type { McpClientHandle } from "@vetta/runtime-mcp/client";
import { createMcpClient } from "@vetta/runtime-node/mcp";
import type { McpServerConfigData } from "../../preload/api-types/mcp.js";
import { readMcpConfig } from "./mcp-settings-service.js";

/**
 * 能力包声明的安装后步骤（`mcp.json` 的 `setup`）由宿主代跑：连上刚装好的 MCP 服务，
 * 调一次它的登录工具，把返回的二维码交给界面显示。扫码结果由服务自己落到数据目录，
 * 完成判定仍走 `completedWhen.dataFile`，本模块不解析登录态。
 *
 * 会话在弹窗打开期间保持存活：受管服务通常在同一进程里等扫码结果，客户端一断开就前功尽弃。
 */

const DEFAULT_TIMEOUT_SECONDS = 180;
/** 首次运行要下载内置浏览器（约 150–190 MB），留足时间再判超时。 */
const CALL_TIMEOUT_MS = 10 * 60_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface McpSetupLoginQrCode {
	/** 可直接用作 <img src> 的 data URL。 */
	readonly image: string;
	/** 服务给出的二维码有效期；缺省时用一个保守值。 */
	readonly expiresInSeconds: number;
}

function textOf(content: readonly McpContent[]): string {
	return content
		.filter((block): block is Extract<McpContent, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function dataUrl(data: string, mimeType: string): string | undefined {
	const value = data.trim();
	if (!value) return undefined;
	if (value.startsWith("data:")) return value;
	// base64 每 4 字符 3 字节
	if ((value.length / 4) * 3 > MAX_IMAGE_BYTES) return undefined;
	return `data:${mimeType || "image/png"};base64,${value}`;
}

/** JSON 里常见的二维码字段名，按优先级尝试。 */
const IMAGE_KEYS = ["img", "image", "qrcode", "qr_code", "qrCode", "qrcode_image", "data"];
const TIMEOUT_KEYS = ["timeout", "timeout_seconds", "timeoutSeconds", "expires_in", "expiresIn"];

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
		if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
	}
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** 服务可能把二维码放在 image 内容块、structuredContent 或一段 JSON 文本里，三种都认。 */
export function readSetupLoginQrCode(result: McpToolCallResult): McpSetupLoginQrCode {
	if (result.isError) throw new Error(textOf(result.content) || "MCP setup tool returned an error");

	const image = result.content.find(
		(block): block is Extract<McpContent, { type: "image" }> => block.type === "image",
	);
	const structured = asRecord(result.structuredContent as McpJsonValue | undefined);
	const text = textOf(result.content).trim();
	let parsedText: Record<string, unknown> | undefined;
	if (text.startsWith("{")) {
		try {
			parsedText = asRecord(JSON.parse(text) as unknown);
		} catch {
			parsedText = undefined;
		}
	}
	const record = structured ?? parsedText;

	const url =
		(image ? dataUrl(image.data, image.mimeType) : undefined) ??
		(record ? dataUrl(pickString(record, IMAGE_KEYS) ?? "", "image/png") : undefined) ??
		(text.startsWith("data:image/") ? text : undefined);
	if (!url) throw new Error("MCP setup tool did not return a QR code image");

	return {
		image: url,
		expiresInSeconds: (record ? pickNumber(record, TIMEOUT_KEYS) : undefined) ?? DEFAULT_TIMEOUT_SECONDS,
	};
}

export interface McpSetupLoginServiceOptions {
	readonly loadServerConfig?: (serverName: string) => Promise<McpServerConfigData | undefined>;
	readonly clientFactory?: typeof createMcpClient;
}

export class McpSetupLoginService {
	private readonly loadServerConfig: (serverName: string) => Promise<McpServerConfigData | undefined>;
	private readonly clientFactory: typeof createMcpClient;
	private session?: { serverName: string; client: McpClientHandle };

	constructor(options: McpSetupLoginServiceOptions = {}) {
		this.loadServerConfig =
			options.loadServerConfig ?? (async (serverName) => (await readMcpConfig()).mcpServers[serverName]);
		this.clientFactory = options.clientFactory ?? createMcpClient;
	}

	/** 连接并调用登录工具；同一时刻只保留一个会话。 */
	async start(serverName: string, tool: string): Promise<McpSetupLoginQrCode> {
		await this.cancel();
		const config = await this.loadServerConfig(serverName);
		if (!config) throw new Error(`MCP server is not configured: ${serverName}`);
		if (config.type === "http") throw new Error("Post-install setup is limited to stdio MCP servers");

		const client = this.clientFactory(serverName, config as never, { timeout: CALL_TIMEOUT_MS });
		this.session = { serverName, client };
		try {
			const result = await client.callTool(tool, {});
			return readSetupLoginQrCode(result);
		} catch (error) {
			await this.cancel();
			throw error;
		}
	}

	/** 关闭会话；弹窗关闭、超时或登录成功后都要调用。 */
	async cancel(): Promise<void> {
		const session = this.session;
		this.session = undefined;
		if (!session) return;
		await session.client.close().catch(() => undefined);
	}
}

let service: McpSetupLoginService | undefined;

export function getDesktopMcpSetupLoginService(): McpSetupLoginService {
	service ??= new McpSetupLoginService();
	return service;
}
