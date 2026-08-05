/**
 * 插件访问 Vetta 服务端的受控通道（ADR-0056）。
 *
 * 插件只交出「相对 `/api/v1` 的路径 + JSON body」，服务端地址与 JWT 都在这里注入，
 * token 不出主进程。插件因此拿不到凭据、也拼不出指向其它接口的绝对 URL——把 JWT
 * 交给插件进程等于开放整个 `/api/v1` 的越权面。
 *
 * 401 由这里刷新后重试一次：让插件自己持有 token 的话，token 一轮换就得再开一个
 * 刷新口子，而插件侧无法单飞去重，并发请求会打出多次刷新。
 */

import type { PluginGatewayRequest, PluginGatewayResponse } from "@vetta-org/plugin-sdk";
import { DEFAULT_SERVER_URL } from "../constants.js";
import { readSettings, tryRefreshAccessToken } from "../ipc/settings.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("plugin-gateway");

const DEFAULT_TIMEOUT_MS = 120_000;
// 生图 30-60s 常见，改图更慢；与服务端图像端点的超时同量级。
const MAX_TIMEOUT_MS = 300_000;
// 改图的源图走 JSON base64 上行，比普通接口请求大一个数量级。
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** 服务端业务信封。插件拿到的是拆开后的结果，不需要认识这层结构。 */
interface ApiEnvelope<T> {
	code?: number;
	message?: string;
	data?: T;
}

/**
 * 路径只接受相对形式：带 scheme 或以 `//` 开头都会被拒，
 * 否则 `//evil.com/x` 会被 URL 解析成另一个 host。
 */
function resolvePath(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "") throw new Error("Gateway path is required");
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
		throw new Error("Gateway path must be relative to /api/v1");
	}
	return trimmed.replace(/^\/+/, "");
}

function baseUrl(): string {
	return `${DEFAULT_SERVER_URL.replace(/\/+$/, "")}/api/v1`;
}

function currentToken(): string | undefined {
	const token = readSettings().serverToken;
	return typeof token === "string" && token !== "" ? token : undefined;
}

async function readBody(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error(`Gateway response exceeds ${MAX_RESPONSE_BYTES} bytes`);
	}
	const text = await response.text();
	if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
		throw new Error(`Gateway response exceeds ${MAX_RESPONSE_BYTES} bytes`);
	}
	return text;
}

function unwrap<T>(status: number, text: string): PluginGatewayResponse<T> {
	let envelope: ApiEnvelope<T> | undefined;
	try {
		envelope = text.length > 0 ? (JSON.parse(text) as ApiEnvelope<T>) : undefined;
	} catch {
		// 非 JSON 响应（网关 502 的 HTML 错误页等）：状态码已足够表达失败
		return { ok: false, status, code: -1, message: text.slice(0, 500) || `HTTP ${status}` };
	}
	const code = envelope?.code ?? -1;
	const ok = status >= 200 && status < 300 && code === 0;
	return {
		ok,
		status,
		code,
		message: envelope?.message ?? (ok ? "" : `HTTP ${status}`),
		data: envelope?.data,
	};
}

/**
 * 发一次网关请求。失败不抛异常而是回结构化结果：配额用尽、档位无权限这类
 * 是常规业务分支，插件要据此渲染引导而非当成异常。
 */
export async function requestGatewayForPlugin<T = unknown>(
	request: PluginGatewayRequest,
	signal?: AbortSignal,
): Promise<PluginGatewayResponse<T>> {
	const url = `${baseUrl()}/${resolvePath(request.path)}`;
	const method = request.method ?? (request.body === undefined ? "GET" : "POST");
	const body = request.body === undefined ? undefined : JSON.stringify(request.body);
	if (body !== undefined && Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
		throw new Error(`Gateway request exceeds ${MAX_REQUEST_BYTES} bytes`);
	}
	const timeoutMs = Math.min(Math.max(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);

	let token = currentToken();
	if (!token) return { ok: false, status: 401, code: -1, message: "Not signed in" };

	const send = async (bearer: string): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(new Error("Gateway request timed out")), timeoutMs);
		const abortFromCaller = (): void => controller.abort(signal?.reason);
		if (signal?.aborted) abortFromCaller();
		else signal?.addEventListener("abort", abortFromCaller, { once: true });
		try {
			return await fetch(url, {
				method,
				body,
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${bearer}`,
					...(body === undefined ? {} : { "Content-Type": "application/json" }),
				},
			});
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abortFromCaller);
		}
	};

	try {
		let response = await send(token);
		if (response.status === 401) {
			const outcome = await tryRefreshAccessToken();
			// transient（网络/超时/5xx）不登出也不重试：原样把 401 回给插件，
			// 由它按「暂不可用」降级，而不是把一次网络抖动放大成掉登录。
			if (outcome.status !== "ok") {
				return { ok: false, status: 401, code: -1, message: "Unauthorized" };
			}
			token = outcome.accessToken;
			response = await send(token);
		}
		return unwrap<T>(response.status, await readBody(response));
	} catch (error) {
		// 调用方归属由 capability 审计层记录（subjectId/sessionId），这里只记路径
		log.warn(`网关请求失败 (${request.path}):`, error);
		return {
			ok: false,
			status: 0,
			code: -1,
			message: error instanceof Error ? error.message : "Gateway request failed",
		};
	}
}
