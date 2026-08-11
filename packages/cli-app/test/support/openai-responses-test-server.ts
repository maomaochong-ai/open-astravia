import { createServer, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

const ProviderRequestSchema = z
	.object({
		model: z.string(),
		input: z.array(z.unknown()),
		stream: z.literal(true),
		tools: z.array(z.unknown()).optional(),
	})
	.loose();

export type ProviderRequest = z.infer<typeof ProviderRequestSchema>;

export interface ProviderRequestRecord {
	readonly body: ProviderRequest;
	readonly rawBody: string;
}

export interface ProviderEventReply {
	readonly kind: "events";
	readonly events: readonly unknown[];
	readonly delayMs?: number;
}

export interface ProviderHeldReply {
	readonly kind: "hold";
	readonly events?: readonly unknown[];
}

export interface ProviderHttpErrorReply {
	readonly kind: "http-error";
	readonly status: number;
	readonly body: string;
}

export interface ProviderDisconnectReply {
	readonly kind: "disconnect";
	readonly events?: readonly unknown[];
	readonly delayMs?: number;
}

export type ProviderReply = ProviderEventReply | ProviderHeldReply | ProviderHttpErrorReply | ProviderDisconnectReply;
export type ProviderRequestHandler = (
	request: ProviderRequestRecord,
	index: number,
) => ProviderReply | Promise<ProviderReply>;

export interface OpenAiResponsesTestServer {
	readonly baseUrl: string;
	readonly requests: readonly ProviderRequestRecord[];
	waitForHeldRequestStarted(timeoutMs?: number): Promise<void>;
	waitForHeldRequestClosed(timeoutMs?: number): Promise<void>;
	dispose(): Promise<void>;
}

export async function startOpenAiResponsesTestServer(
	handler: ProviderRequestHandler,
): Promise<OpenAiResponsesTestServer> {
	const requests: ProviderRequestRecord[] = [];
	let heldRequestClosed: Promise<void> | undefined;
	let resolveHeldRequestClosed: (() => void) | undefined;
	let resolveHeldRequestStarted: (() => void) | undefined;
	const heldRequestStarted = new Promise<void>((resolve) => {
		resolveHeldRequestStarted = resolve;
	});
	const server = createServer(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/responses") {
			response.writeHead(404).end();
			return;
		}
		try {
			const rawBody = await readBody(request);
			const body = ProviderRequestSchema.parse(JSON.parse(rawBody));
			const record = { body, rawBody };
			const index = requests.push(record) - 1;
			const reply = await handler(record, index);
			if (reply.kind === "http-error") {
				response.writeHead(reply.status, { "content-type": "text/plain" });
				response.end(reply.body);
				return;
			}
			writeSseHeaders(response);
			for (const event of reply.events ?? []) {
				response.write(`data: ${JSON.stringify(event)}\n\n`);
				if (reply.kind === "events" && reply.delayMs) await delay(reply.delayMs);
			}
			if (reply.kind === "disconnect") {
				if (reply.delayMs) await delay(reply.delayMs);
				response.destroy();
				return;
			}
			if (reply.kind === "events") {
				response.end("data: [DONE]\n\n");
				return;
			}
			heldRequestClosed = new Promise<void>((resolve) => {
				resolveHeldRequestClosed = resolve;
			});
			response.once("close", () => resolveHeldRequestClosed?.());
			resolveHeldRequestStarted?.();
		} catch (error) {
			if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
			response.end(error instanceof Error ? error.stack : String(error));
		}
	});
	await listen(server);
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("Expected OpenAI Responses test server TCP address");
	}
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		get requests() {
			return requests;
		},
		async waitForHeldRequestStarted(timeoutMs = 10_000) {
			await withTimeout(heldRequestStarted, timeoutMs, "Timed out waiting for held Provider request to start");
		},
		async waitForHeldRequestClosed(timeoutMs = 10_000) {
			const pending = heldRequestClosed;
			if (!pending) throw new Error("No held Provider request is active");
			await withTimeout(pending, timeoutMs, "Timed out waiting for held Provider request to close");
		},
		async dispose() {
			server.closeAllConnections?.();
			await closeServer(server);
		},
	};
}

export function textResponseEvents(
	text: string,
	options: { readonly inputTokens?: number; readonly outputTokens?: number; readonly responseId?: string } = {},
): readonly unknown[] {
	const responseId = options.responseId ?? "resp_text";
	const item = {
		type: "message",
		id: `msg_${responseId}`,
		status: "completed",
		role: "assistant",
		content: [{ type: "output_text", text, annotations: [] }],
	};
	return [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", content: [] },
		},
		{
			type: "response.content_part.added",
			item_id: item.id,
			output_index: 0,
			content_index: 0,
			part: { type: "output_text", text: "", annotations: [] },
		},
		{ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item },
		completedResponse(responseId, options.inputTokens ?? 10, options.outputTokens ?? 5),
	];
}

export function toolCallResponseEvents(
	name: string,
	argumentsValue: Readonly<Record<string, unknown>>,
	options: { readonly callId?: string; readonly itemId?: string; readonly responseId?: string } = {},
): readonly unknown[] {
	const callId = options.callId ?? "call_test";
	const itemId = options.itemId ?? "fc_test";
	const responseId = options.responseId ?? "resp_tool";
	const argumentsJson = JSON.stringify(argumentsValue);
	const item = {
		type: "function_call",
		id: itemId,
		call_id: callId,
		name,
		arguments: argumentsJson,
		status: "completed",
	};
	return [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", arguments: "" },
		},
		{
			type: "response.function_call_arguments.delta",
			item_id: itemId,
			output_index: 0,
			delta: argumentsJson,
		},
		{
			type: "response.function_call_arguments.done",
			item_id: itemId,
			output_index: 0,
			arguments: argumentsJson,
		},
		{ type: "response.output_item.done", output_index: 0, item },
		completedResponse(responseId, 10, 5),
	];
}

function completedResponse(responseId: string, inputTokens: number, outputTokens: number): unknown {
	return {
		type: "response.completed",
		response: {
			id: responseId,
			object: "response",
			status: "completed",
			output: [],
			usage: {
				input_tokens: inputTokens,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens: outputTokens,
				output_tokens_details: { reasoning_tokens: 0 },
				total_tokens: inputTokens + outputTokens,
			},
		},
	};
}

function writeSseHeaders(response: ServerResponse): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function listen(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
}

async function closeServer(server: Server): Promise<void> {
	if (!server.listening) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function withTimeout(promise: Promise<void>, timeoutMs: number, message: string): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
	});
	await Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
