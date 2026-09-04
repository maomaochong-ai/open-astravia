/**
 * stdio ⇄ streamable HTTP 的 MCP 透传：按 JSON-RPC 逐条转发，不解释具体方法，
 * 因此工具、资源、通知都不需要在这里逐个适配。
 *
 * 传输细节：POST 一条消息，服务端要么直接回 JSON，要么回一段 SSE；两种都把其中的
 * JSON-RPC 消息原样写回 stdout。initialize 的响应头里带 mcp-session-id 时记下来，
 * 之后每次请求都带上。
 */

const JSON_RPC_ACCEPT = "application/json, text/event-stream";

export interface HttpMcpProxyOptions {
	readonly url: string;
	readonly fetchImpl?: typeof fetch;
	/** 写回 stdout 的一条 JSON-RPC 消息（不含换行）。 */
	readonly write: (line: string) => void;
	readonly onDiagnostic?: (message: string) => void;
}

/** SSE 帧里可能有多行 data:，按规范拼成一条消息。 */
export function readSseMessages(chunk: string): string[] {
	const messages: string[] = [];
	for (const frame of chunk.split(/\n\n/)) {
		const data = frame
			.split(/\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.join("");
		if (data) messages.push(data);
	}
	return messages;
}

export class HttpMcpProxy {
	private readonly url: string;
	private readonly fetchImpl: typeof fetch;
	private readonly write: (line: string) => void;
	private readonly onDiagnostic: (message: string) => void;
	private sessionId?: string;
	private buffer = "";

	constructor(options: HttpMcpProxyOptions) {
		this.url = options.url;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.write = options.write;
		this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
	}

	/** stdio 侧是换行分隔的 JSON，喂进来多少处理多少。 */
	async consume(chunk: string): Promise<void> {
		this.buffer += chunk;
		let newline = this.buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line) await this.forward(line);
			newline = this.buffer.indexOf("\n");
		}
	}

	private async forward(line: string): Promise<void> {
		let response: Response;
		try {
			response = await this.fetchImpl(this.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: JSON_RPC_ACCEPT,
					...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
				},
				body: line,
			});
		} catch (error) {
			this.replyTransportError(line, error instanceof Error ? error.message : String(error));
			return;
		}

		const session = response.headers.get("mcp-session-id");
		if (session) this.sessionId = session;

		if (!response.ok) {
			this.replyTransportError(line, `HTTP ${response.status}`);
			return;
		}
		// 通知类消息服务端回 202，没有 body
		if (response.status === 202) return;

		const contentType = response.headers.get("content-type") ?? "";
		const body = await response.text();
		if (contentType.includes("text/event-stream")) {
			for (const message of readSseMessages(body)) this.write(message);
			return;
		}
		if (body.trim()) this.write(body.trim());
	}

	/**
	 * 传输层失败时也要给出 JSON-RPC 响应，否则客户端只能等到超时。
	 * 通知没有 id，无从回复，只记一条诊断。
	 */
	private replyTransportError(line: string, reason: string): void {
		this.onDiagnostic(`request failed: ${reason}`);
		let id: unknown;
		try {
			id = (JSON.parse(line) as { id?: unknown }).id;
		} catch {
			id = undefined;
		}
		if (id === undefined || id === null) return;
		this.write(
			JSON.stringify({
				jsonrpc: "2.0",
				id,
				error: { code: -32000, message: `MCP HTTP bridge request failed: ${reason}` },
			}),
		);
	}
}
