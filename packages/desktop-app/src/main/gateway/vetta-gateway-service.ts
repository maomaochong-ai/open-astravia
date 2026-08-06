import { DEFAULT_SERVER_URL } from "../constants.js";
import { readSettings, tryRefreshAccessToken } from "../ipc/settings.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("vetta-gateway");

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface VettaGatewayRequest {
	path: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	timeoutMs?: number;
}

export interface VettaGatewayResponse<T = unknown> {
	ok: boolean;
	status: number;
	code: number;
	message: string;
	data?: T;
}

interface ApiEnvelope<T> {
	code?: number;
	message?: string;
	data?: T;
}

function resolvePath(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "") throw new Error("Gateway path is required");
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
		throw new Error("Gateway path must be relative to /api/v1");
	}
	return trimmed.replace(/^\/+/, "");
}

function baseUrl(): string {
	return DEFAULT_SERVER_URL.replace(/\/+$/, "");
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
	const body = await response.text();
	if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
		throw new Error(`Gateway response exceeds ${MAX_RESPONSE_BYTES} bytes`);
	}
	return body;
}

function unwrap<T>(status: number, body: string): VettaGatewayResponse<T> {
	let envelope: ApiEnvelope<T> | undefined;
	try {
		envelope = body.length > 0 ? (JSON.parse(body) as ApiEnvelope<T>) : undefined;
	} catch {
		return { ok: false, status, code: -1, message: body.slice(0, 500) || `HTTP ${status}` };
	}
	const code = envelope?.code ?? -1;
	const ok = status >= 200 && status < 300 && code === 0;
	const result: VettaGatewayResponse<T> = {
		ok,
		status,
		code,
		message: envelope?.message ?? (ok ? "" : `HTTP ${status}`),
	};
	if (envelope?.data !== undefined) result.data = envelope.data;
	return result;
}

/** Authenticated Vetta `/api/v1` transport. Callers never receive the token. */
export async function requestVettaGateway<T = unknown>(
	request: VettaGatewayRequest,
	signal?: AbortSignal,
): Promise<VettaGatewayResponse<T>> {
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
			if (outcome.status !== "ok") {
				return { ok: false, status: 401, code: -1, message: "Unauthorized" };
			}
			token = outcome.accessToken;
			response = await send(token);
		}
		return unwrap<T>(response.status, await readBody(response));
	} catch (error) {
		log.warn(`网关请求失败 (${request.path}):`, error);
		return {
			ok: false,
			status: 0,
			code: -1,
			message: error instanceof Error ? error.message : "Gateway request failed",
		};
	}
}
