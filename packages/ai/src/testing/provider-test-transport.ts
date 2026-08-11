import { AI_ERROR_CODES, AIAbortedError, AIError } from "../protocol/index.js";
import type { FetchFunction } from "../types.js";

export interface ProviderTestRequest {
	readonly url: string;
	readonly method: string;
	readonly headers: Headers;
	readonly body?: string;
	readonly signal: AbortSignal;
}

export type ProviderTestResponseFactory = (
	request: ProviderTestRequest,
	callIndex: number,
) => Response | Promise<Response>;

export type ProviderTestOutcome = Response | Error | ProviderTestResponseFactory;

export interface ProviderTestTransport {
	readonly fetch: FetchFunction;
	readonly requests: ProviderTestRequest[];
	readonly remaining: number;
}

export interface SseRecord {
	readonly event?: string;
	readonly data: unknown;
}

export interface ControlledSseResponse {
	readonly response: Response;
	emit(record: SseRecord): void;
	close(): void;
	fail(error: unknown): void;
}

const encoder = new TextEncoder();

export function createProviderTestTransport(outcomes: readonly ProviderTestOutcome[]): ProviderTestTransport {
	const remainingOutcomes = [...outcomes];
	const requests: ProviderTestRequest[] = [];
	const fetch: FetchFunction = async (input, init) => {
		const request = new Request(input, init);
		if (request.signal.aborted) throw new AIAbortedError();
		const snapshot: ProviderTestRequest = {
			url: request.url,
			method: request.method,
			headers: new Headers(request.headers),
			body: request.body ? await request.clone().text() : undefined,
			signal: request.signal,
		};
		const callIndex = requests.length;
		requests.push(snapshot);
		const outcome = remainingOutcomes.shift();
		if (!outcome) {
			throw new AIError(AI_ERROR_CODES.INVALID_REQUEST, "No provider test response remains", {
				metadata: { callIndex, url: request.url },
			});
		}
		if (outcome instanceof Error) throw outcome;
		return typeof outcome === "function" ? outcome(snapshot, callIndex) : outcome;
	};

	return {
		fetch,
		requests,
		get remaining() {
			return remainingOutcomes.length;
		},
	};
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type")) headers.set("content-type", "application/json");
	return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(status: number, body: unknown, init: ResponseInit = {}): Response {
	return jsonResponse(body, { ...init, status });
}

export function sseResponse(records: readonly SseRecord[], init: ResponseInit = {}): Response {
	return new Response(records.map(encodeSseRecord).join(""), withSseHeaders(init));
}

export function emptySseResponse(init: ResponseInit = {}): Response {
	return new Response("", withSseHeaders(init));
}

export function createControlledSseResponse(init: ResponseInit = {}): ControlledSseResponse {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const body = new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
		},
	});
	return {
		response: new Response(body, withSseHeaders(init)),
		emit(record) {
			controller?.enqueue(encoder.encode(encodeSseRecord(record)));
		},
		close() {
			controller?.close();
		},
		fail(error) {
			controller?.error(error);
		},
	};
}

function encodeSseRecord(record: SseRecord): string {
	const event = record.event ? `event: ${record.event}\n` : "";
	const data = typeof record.data === "string" ? record.data : JSON.stringify(record.data);
	return `${event}data: ${data}\n\n`;
}

function withSseHeaders(init: ResponseInit): ResponseInit {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type")) headers.set("content-type", "text/event-stream");
	return { ...init, headers };
}
