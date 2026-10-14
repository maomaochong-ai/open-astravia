import type { Provider } from "../../protocol/index.js";
import { createResponsesJsonParseError } from "./response-schema.js";

/**
 * OpenAI Responses 协议族的共享 WebSocket transport。
 *
 * 同一条长连接通过 `response.create` 帧承载一次请求，事件帧与 SSE 逐条对应；
 * sessionId 相同的调用复用连接，让上游会话/提示缓存保持局部性。Codex 与通用
 * OpenAI Responses 只在 URL、鉴权头和事件归一化上不同，连接生命周期都在这里。
 */
export const RESPONSES_WEBSOCKET_BETA_HEADER = "responses_websockets=2026-02-06";

const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;

type WebSocketEventType = "open" | "message" | "error" | "close";
type WebSocketListener = (event: unknown) => void;

export interface ResponsesWebSocket {
	close(code?: number, reason?: string): void;
	send(data: string): void;
	addEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
	removeEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
}

interface CachedWebSocketConnection {
	socket: ResponsesWebSocket;
	busy: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
}

type WebSocketConstructor = new (
	url: string,
	protocols?: string | string[] | { headers?: Record<string, string> },
) => ResponsesWebSocket;

const websocketSessionCache = new Map<string, CachedWebSocketConnection>();

export interface AcquiredResponsesWebSocket {
	readonly socket: ResponsesWebSocket;
	readonly release: (options?: { keep?: boolean }) => void;
}

/** HTTP(S) URL 转 WS(S)；不改动路径，路径拼接归各 Provider。 */
export function toWebSocketUrl(httpUrl: string): string {
	const url = new URL(httpUrl);
	if (url.protocol === "https:") url.protocol = "wss:";
	if (url.protocol === "http:") url.protocol = "ws:";
	return url.toString();
}

/** 通用 OpenAI Responses 端点：`<baseUrl>/responses` 的 WS 形式。 */
export function resolveResponsesWebSocketUrl(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	return toWebSocketUrl(normalized.endsWith("/responses") ? normalized : `${normalized}/responses`);
}

export async function acquireResponsesWebSocket(
	url: string,
	headers: Record<string, string>,
	sessionId?: string,
	signal?: AbortSignal,
): Promise<AcquiredResponsesWebSocket> {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal);
		return { socket, release: () => closeWebSocketSilently(socket) };
	}

	const cacheKey = `${url}\n${credentialFingerprint(headers)}\n${sessionId}`;
	const cached = websocketSessionCache.get(cacheKey);
	if (cached) {
		if (cached.idleTimer) {
			clearTimeout(cached.idleTimer);
			cached.idleTimer = undefined;
		}
		if (!cached.busy && isWebSocketReusable(cached.socket)) {
			cached.busy = true;
			return {
				socket: cached.socket,
				release: ({ keep } = {}) => {
					if (!keep || !isWebSocketReusable(cached.socket)) {
						closeWebSocketSilently(cached.socket);
						websocketSessionCache.delete(cacheKey);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(cacheKey, cached);
				},
			};
		}
		if (cached.busy) {
			const socket = await connectWebSocket(url, headers, signal);
			return { socket, release: () => closeWebSocketSilently(socket) };
		}
		if (!isWebSocketReusable(cached.socket)) {
			closeWebSocketSilently(cached.socket);
			websocketSessionCache.delete(cacheKey);
		}
	}

	const socket = await connectWebSocket(url, headers, signal);
	const entry: CachedWebSocketConnection = { socket, busy: true };
	websocketSessionCache.set(cacheKey, entry);
	return {
		socket,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				if (websocketSessionCache.get(cacheKey) === entry) websocketSessionCache.delete(cacheKey);
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(cacheKey, entry);
		},
	};
}

/** 逐帧产出 WS 上的 Responses 事件；终态帧到达前断连视为失败。 */
export async function* readResponsesWebSocketEvents(
	socket: ResponsesWebSocket,
	provider: Provider,
	signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
	const queue: Record<string, unknown>[] = [];
	let pending: (() => void) | null = null;
	let done = false;
	let failed: Error | null = null;
	let sawCompletion = false;
	const wake = () => {
		if (!pending) return;
		const resolve = pending;
		pending = null;
		resolve();
	};
	const onMessage: WebSocketListener = (event) => {
		void (async () => {
			if (!event || typeof event !== "object" || !("data" in event)) return;
			const text = await decodeWebSocketData((event as { data?: unknown }).data);
			if (!text) return;
			try {
				const parsed = JSON.parse(text) as Record<string, unknown>;
				const type = typeof parsed.type === "string" ? parsed.type : "";
				if (
					type === "response.completed" ||
					type === "response.done" ||
					type === "response.incomplete" ||
					type === "response.failed"
				) {
					sawCompletion = true;
					done = true;
				}
				queue.push(parsed);
				wake();
			} catch (error) {
				failed = createResponsesJsonParseError(provider, error);
				done = true;
				wake();
			}
		})();
	};
	const onError: WebSocketListener = (event) => {
		failed = extractWebSocketError(event);
		done = true;
		wake();
	};
	const onClose: WebSocketListener = (event) => {
		if (!sawCompletion && !failed) failed = extractWebSocketCloseError(event);
		done = true;
		wake();
	};
	const onAbort = () => {
		failed = new Error("Request was aborted");
		done = true;
		wake();
	};

	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", onError);
	socket.addEventListener("close", onClose);
	signal?.addEventListener("abort", onAbort);
	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			if (queue.length > 0) {
				yield queue.shift() as Record<string, unknown>;
				continue;
			}
			if (done) break;
			await new Promise<void>((resolve) => {
				pending = resolve;
			});
		}
		if (failed) throw failed;
		if (!sawCompletion) throw new Error("WebSocket stream closed before response.completed");
	} finally {
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", onError);
		socket.removeEventListener("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function connectWebSocket(
	url: string,
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<ResponsesWebSocket> {
	const WebSocketConstructor = getWebSocketConstructor();
	if (!WebSocketConstructor) throw new Error("WebSocket transport is not available in this runtime");
	const socketHeaders = { ...headers, "OpenAI-Beta": RESPONSES_WEBSOCKET_BETA_HEADER };

	return new Promise<ResponsesWebSocket>((resolve, reject) => {
		let settled = false;
		let socket: ResponsesWebSocket;
		try {
			socket = new WebSocketConstructor(url, { headers: socketHeaders });
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		const onOpen: WebSocketListener = () => settle(() => resolve(socket));
		const onError: WebSocketListener = (event) => settle(() => reject(extractWebSocketError(event)));
		const onClose: WebSocketListener = (event) => settle(() => reject(extractWebSocketCloseError(event)));
		const onAbort = () =>
			settle(() => {
				socket.close(1000, "aborted");
				reject(new Error("Request was aborted"));
			});
		const cleanup = () => {
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			signal?.removeEventListener("abort", onAbort);
		};
		const settle = (complete: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			complete();
		};

		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		signal?.addEventListener("abort", onAbort);
	});
}

function getWebSocketConstructor(): WebSocketConstructor | null {
	const webSocketConstructor = (globalThis as { WebSocket?: unknown }).WebSocket;
	return typeof webSocketConstructor === "function" ? (webSocketConstructor as unknown as WebSocketConstructor) : null;
}

function isWebSocketReusable(socket: ResponsesWebSocket): boolean {
	const readyState = (socket as { readyState?: unknown }).readyState;
	return typeof readyState !== "number" || readyState === 1;
}

function credentialFingerprint(headers: Record<string, string>): string {
	const credential = headers.Authorization ?? headers.authorization ?? "";
	let hash = 2166136261;
	for (let index = 0; index < credential.length; index += 1) {
		hash ^= credential.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

function closeWebSocketSilently(socket: ResponsesWebSocket, code = 1000, reason = "done"): void {
	try {
		socket.close(code, reason);
	} catch {}
}

function scheduleSessionWebSocketExpiry(cacheKey: string, entry: CachedWebSocketConnection): void {
	if (entry.idleTimer) clearTimeout(entry.idleTimer);
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
		websocketSessionCache.delete(cacheKey);
	}, SESSION_WEBSOCKET_CACHE_TTL_MS);
}

function extractWebSocketError(event: unknown): Error {
	if (event && typeof event === "object" && "message" in event) {
		const message = (event as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) return new Error(message);
	}
	return new Error("WebSocket error");
}

function extractWebSocketCloseError(event: unknown): Error {
	if (!event || typeof event !== "object") return new Error("WebSocket closed");
	const code = "code" in event ? (event as { code?: unknown }).code : undefined;
	const reason = "reason" in event ? (event as { reason?: unknown }).reason : undefined;
	const codeText = typeof code === "number" ? ` ${code}` : "";
	const reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
	return new Error(`WebSocket closed${codeText}${reasonText}`.trim());
}

async function decodeWebSocketData(data: unknown): Promise<string | null> {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}
	if (data && typeof data === "object" && "arrayBuffer" in data) {
		const arrayBuffer = await (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
		return new TextDecoder().decode(new Uint8Array(arrayBuffer));
	}
	return null;
}
