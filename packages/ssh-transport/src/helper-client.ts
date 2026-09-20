import type { SshProcessChannel } from "./process-runner.js";

/**
 * 与远端 helper（`apps/ssh-helper`）对话的客户端。
 *
 * 协议是行分隔 JSON：请求 `{id, method, params}`，响应 `{id, result | error}`，通知没有 `id`。
 * 协议版本是语义化版本号而不是构建哈希（ADR-0124）：远端可能还留着旧版本 helper 起的
 * 任务，新客户端必须仍能连上去接管它们。
 */
export const HELPER_PROTOCOL_VERSION = "1.0.0";

/** helper 明确回答了「不行」。与「问不到」（通道断了）是两种失败。 */
export class SshHelperError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "SshHelperError";
	}
}

/** 通道已经关闭：请求可能已经执行，也可能没有，结果不可知。 */
export class SshHelperClosedError extends Error {
	readonly verdict = "unverifiable" as const;

	constructor(message: string) {
		super(message);
		this.name = "SshHelperClosedError";
	}
}

export interface SshHelperHello {
	readonly protocolVersion: string;
	readonly os: string;
	readonly arch: string;
	readonly home: string;
}

interface Pending {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
}

type NotificationListener = (params: unknown) => void;

export class SshHelperClient {
	private nextId = 1;
	private buffered = "";
	private closed: Error | undefined;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Map<string, Set<NotificationListener>>();
	private readonly decoder = new TextDecoder();
	private readonly closeListeners = new Set<() => void>();

	private constructor(private readonly channel: SshProcessChannel) {
		void channel.exited.then(({ exitCode, stderr }) => {
			const detail = stderr.trim();
			this.fail(
				new SshHelperClosedError(
					`The remote helper exited (code ${exitCode ?? "signal"})${detail ? `: ${detail}` : "."}`,
				),
			);
		});
	}

	/**
	 * 接到一条已经打开的通道上。`open` 的调用方把通道的 stdout 交给返回的 `feed`。
	 * 拆成两步是因为通道在创建时就要拿到 stdout 回调，而客户端又需要通道来写请求。
	 */
	static attach(open: (feed: (chunk: Uint8Array) => void) => SshProcessChannel): SshHelperClient {
		let client: SshHelperClient | undefined;
		const early: Uint8Array[] = [];
		const channel = open((chunk) => {
			if (client) client.feed(chunk);
			else early.push(chunk);
		});
		client = new SshHelperClient(channel);
		for (const chunk of early) client.feed(chunk);
		return client;
	}

	get isClosed(): boolean {
		return this.closed !== undefined;
	}

	call<Result>(method: string, params?: unknown): Promise<Result> {
		if (this.closed) return Promise.reject(this.closed);
		const id = this.nextId++;
		return new Promise<Result>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.channel.write(new TextEncoder().encode(`${JSON.stringify({ id, method, params })}\n`));
		});
	}

	/** 订阅通知；返回取消订阅的函数。 */
	on(method: string, listener: NotificationListener): () => void {
		let set = this.listeners.get(method);
		if (!set) {
			set = new Set();
			this.listeners.set(method, set);
		}
		set.add(listener);
		return () => set.delete(listener);
	}

	onClose(listener: () => void): () => void {
		if (this.closed) {
			listener();
			return () => {};
		}
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	/** 关掉 stdin 让 helper 收尾退出。它托管的后台任务不受影响——那正是它存在的意义。 */
	close(): void {
		this.channel.end();
		this.fail(new SshHelperClosedError("The remote helper connection was closed."));
	}

	private feed(chunk: Uint8Array): void {
		this.buffered += this.decoder.decode(chunk, { stream: true });
		let newline = this.buffered.indexOf("\n");
		while (newline !== -1) {
			const line = this.buffered.slice(0, newline);
			this.buffered = this.buffered.slice(newline + 1);
			if (line.trim().length > 0) this.dispatch(line);
			newline = this.buffered.indexOf("\n");
		}
	}

	private dispatch(line: string): void {
		let message: {
			id?: number;
			result?: unknown;
			error?: { code?: string; message?: string };
			method?: string;
			params?: unknown;
		};
		try {
			message = JSON.parse(line);
		} catch {
			// 登录横幅之类混进 stdout 的杂讯：不是协议帧，丢掉即可。
			return;
		}
		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error) {
				pending.reject(new SshHelperError(message.error.code ?? "EIO", message.error.message ?? "helper error"));
			} else {
				pending.resolve(message.result);
			}
			return;
		}
		// 不认识的通知直接忽略：新版本 helper 可以多推消息而不破坏旧客户端。
		if (typeof message.method === "string") {
			for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
		}
	}

	private fail(error: Error): void {
		if (this.closed) return;
		this.closed = error;
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		for (const listener of this.closeListeners) listener();
		this.closeListeners.clear();
	}
}

/** 主版本一致即可互通：次版本只增不改，客户端忽略不认识的东西。 */
export function isCompatibleHelperVersion(remoteVersion: string, localVersion = HELPER_PROTOCOL_VERSION): boolean {
	const major = (version: string): string => version.split(".")[0] ?? "";
	return major(remoteVersion) !== "" && major(remoteVersion) === major(localVersion);
}
