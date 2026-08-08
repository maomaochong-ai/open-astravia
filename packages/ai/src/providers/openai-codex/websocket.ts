import type { AssistantMessage, Model } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { processCodexEvents } from "./events.js";
import type { CodexRequestBody, OpenAICodexResponsesOptions } from "./options.js";

const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;

type WebSocketEventType = "open" | "message" | "error" | "close";
type WebSocketListener = (event: unknown) => void;

interface WebSocketLike {
	close(code?: number, reason?: string): void;
	send(data: string): void;
	addEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
	removeEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
}

interface CachedWebSocketConnection {
	socket: WebSocketLike;
	busy: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
}

type WebSocketConstructor = new (
	url: string,
	protocols?: string | string[] | { headers?: Record<string, string> },
) => WebSocketLike;

const websocketSessionCache = new Map<string, CachedWebSocketConnection>();

export async function processCodexWebSocketStream(
	url: string,
	body: CodexRequestBody,
	headers: Headers,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"openai-codex-responses">,
	onStart: () => void,
	options?: OpenAICodexResponsesOptions,
): Promise<void> {
	const { socket, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal);
	let keepConnection = true;
	try {
		socket.send(JSON.stringify({ type: "response.create", ...body }));
		onStart();
		stream.push({ type: "start", partial: output });
		await processCodexEvents(parseWebSocket(socket, options?.signal), output, stream, model);
		if (options?.signal?.aborted) keepConnection = false;
	} catch (error) {
		keepConnection = false;
		throw error;
	} finally {
		release({ keep: keepConnection });
	}
}

async function acquireWebSocket(
	url: string,
	headers: Headers,
	sessionId: string | undefined,
	signal?: AbortSignal,
): Promise<{ socket: WebSocketLike; release: (options?: { keep?: boolean }) => void }> {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal);
		return {
			socket,
			release: () => closeWebSocketSilently(socket),
		};
	}

	const cached = websocketSessionCache.get(sessionId);
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
						websocketSessionCache.delete(sessionId);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(sessionId, cached);
				},
			};
		}
		if (cached.busy) {
			const socket = await connectWebSocket(url, headers, signal);
			return { socket, release: () => closeWebSocketSilently(socket) };
		}
		if (!isWebSocketReusable(cached.socket)) {
			closeWebSocketSilently(cached.socket);
			websocketSessionCache.delete(sessionId);
		}
	}

	const socket = await connectWebSocket(url, headers, signal);
	const entry: CachedWebSocketConnection = { socket, busy: true };
	websocketSessionCache.set(sessionId, entry);
	return {
		socket,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				if (websocketSessionCache.get(sessionId) === entry) websocketSessionCache.delete(sessionId);
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(sessionId, entry);
		},
	};
}

async function connectWebSocket(url: string, headers: Headers, signal?: AbortSignal): Promise<WebSocketLike> {
	const WebSocketConstructor = getWebSocketConstructor();
	if (!WebSocketConstructor) throw new Error("WebSocket transport is not available in this runtime");
	const socketHeaders = headersToRecord(headers);
	socketHeaders["OpenAI-Beta"] = OPENAI_BETA_RESPONSES_WEBSOCKETS;

	return new Promise<WebSocketLike>((resolve, reject) => {
		let settled = false;
		let socket: WebSocketLike;
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

async function* parseWebSocket(socket: WebSocketLike, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
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
				if (type === "response.completed" || type === "response.done") {
					sawCompletion = true;
					done = true;
				}
				queue.push(parsed);
				wake();
			} catch {}
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

function getWebSocketConstructor(): WebSocketConstructor | null {
	const webSocketConstructor = (globalThis as { WebSocket?: unknown }).WebSocket;
	return typeof webSocketConstructor === "function" ? (webSocketConstructor as unknown as WebSocketConstructor) : null;
}

function headersToRecord(headers: Headers): Record<string, string> {
	const record: Record<string, string> = {};
	for (const [key, value] of headers.entries()) record[key] = value;
	return record;
}

function isWebSocketReusable(socket: WebSocketLike): boolean {
	const readyState = (socket as { readyState?: unknown }).readyState;
	return typeof readyState !== "number" || readyState === 1;
}

function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
	try {
		socket.close(code, reason);
	} catch {}
}

function scheduleSessionWebSocketExpiry(sessionId: string, entry: CachedWebSocketConnection): void {
	if (entry.idleTimer) clearTimeout(entry.idleTimer);
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
		websocketSessionCache.delete(sessionId);
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
