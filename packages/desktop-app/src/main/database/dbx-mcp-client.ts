import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolveDbxMcpBinaryPath } from "../mcp/dbx-mcp-path.js";

/**
 * 轻量 MCP stdio 客户端（仅服务 dbx-mcp 单服务器场景）。
 *
 * 职责：管理 dbx-mcp.exe 子进程生命周期，完成 JSON-RPC 握手，
 * 并提供 tools/call 单发请求。不引入 @modelcontextprotocol/sdk 依赖
 * （desktop-app 无此依赖，且只需单服务器、无流式需求）。
 *
 * dbx 工具的返回统一是 Markdown 文本（content[].text），结构化解析
 * 由上层 database-service 完成，本层只做协议传输。
 */

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
}

export interface DbxToolResult {
	/** 原始 content 数组（dbx 目前全部是 text 类型）。 */
	content: Array<{ type: string; text: string }>;
	/** dbx 工具调用失败时为 true（如 SQL_BLOCKED / DBX_NOT_RUNNING）。 */
	isError: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 2_000;

export class DbxMcpClient {
	private child: ChildProcessWithoutNullStreams | null = null;
	private buffer = "";
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private initialized: Promise<void> | null = null;

	/** 确保子进程已启动并完成 initialize 握手。 */
	ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			this.initialized = this.spawnAndHandshake();
		}
		return this.initialized;
	}

	/** 调用 dbx MCP 工具，返回结构化结果。工具错误（isError）不抛异常，由上层判断。 */
	async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<DbxToolResult> {
		await this.ensureInitialized();
		const id = this.nextId++;
		const result = await this.request(id, "tools/call", { name, arguments: args }, timeoutMs ?? CALL_TIMEOUT_MS);
		return result as DbxToolResult;
	}

	/** 关闭子进程（幂等）。 */
	async dispose(): Promise<void> {
		const child = this.child;
		this.child = null;
		this.initialized = null;
		if (!child || child.killed) return;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		child.kill();
		await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))]);
		if (!child.killed) child.kill("SIGKILL");
		for (const p of this.pending.values()) p.reject(new Error("dbx-mcp client disposed"));
		this.pending.clear();
	}

	private spawnAndHandshake(): Promise<void> {
		const bin = resolveDbxMcpBinaryPath();
		const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
		this.child = child;

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.onData(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			// dbx-mcp 可能在 stderr 打日志，仅调试用
			process.stderr.write(`[dbx-mcp] ${chunk.toString()}`);
		});
		child.on("exit", (code, signal) => {
			const err = new Error(`dbx-mcp exited (code=${code}, signal=${signal})`);
			for (const p of this.pending.values()) p.reject(err);
			this.pending.clear();
			this.child = null;
			this.initialized = null;
		});
		child.on("error", (err) => {
			for (const p of this.pending.values()) p.reject(err);
			this.pending.clear();
		});

		return new Promise<void>((resolve, reject) => {
			this.request(
				0,
				"initialize",
				{
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "astravia-desktop", version: "1.0.0" },
				},
				HANDSHAKE_TIMEOUT_MS,
			)
				.then(() => {
					this.sendNotification("notifications/initialized", {});
					resolve();
				})
				.catch((err) => reject(err));
		});
	}

	private request(id: number, method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`dbx-mcp request "${method}" timeout after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (result) => {
					clearTimeout(timer);
					resolve(result);
				},
				reject: (err) => {
					clearTimeout(timer);
					reject(err);
				},
			});
			this.sendMessage({ jsonrpc: "2.0", id, method, params });
		});
	}

	private sendNotification(method: string, params: Record<string, unknown>): void {
		this.sendMessage({ jsonrpc: "2.0", method, params });
	}

	private sendMessage(message: unknown): void {
		if (!this.child) throw new Error("dbx-mcp client not started");
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let idx = this.buffer.indexOf("\n");
		while (idx !== -1) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) continue;
			this.handleLine(line);
			idx = this.buffer.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		let message: { id?: number; result?: unknown; error?: unknown };
		try {
			message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
		} catch {
			return; // 非 JSON 行（日志）忽略
		}
		if (typeof message.id !== "number") return; // 服务端主动通知忽略
		const p = this.pending.get(message.id);
		if (!p) return;
		this.pending.delete(message.id);
		if (message.error) {
			const msg =
				typeof message.error === "object" && message.error !== null && "message" in message.error
					? String((message.error as { message: unknown }).message)
					: "dbx-mcp request error";
			p.reject(new Error(msg));
		} else {
			p.resolve(message.result);
		}
	}
}

/** 单例：整个桌面应用共享一个 dbx-mcp 子进程。 */
let client: DbxMcpClient | null = null;

export function getDbxMcpClient(): DbxMcpClient {
	if (!client) client = new DbxMcpClient();
	return client;
}

export async function disposeDbxMcpClient(): Promise<void> {
	if (client) {
		await client.dispose();
		client = null;
	}
}
