import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rm, stat, utimes } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ConversationOwnershipConflictError, type ConversationOwnershipHolder } from "./errors.js";
import { nodeErrorCode } from "./node-error-code.js";
import { currentProcessStartedAtMs, isLocalProcessAlive, readLocalProcessStartedAtMs } from "./process-identity.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 2 * 60_000;
const ACQUIRE_RACE_RETRY_COUNT = 3;
const PROCESS_START_TOLERANCE_MS = 5_000;

const ConversationOwnershipHolderSchema = Type.Object(
	{
		token: Type.String({ minLength: 1 }),
		pid: Type.Integer({ minimum: 1 }),
		hostname: Type.String({ minLength: 1 }),
		acquiredAt: Type.String({ minLength: 1 }),
		processStartedAt: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);

export interface ConversationOwnershipLease {
	readonly conversationPath: string;
	readonly lockPath: string;
	readonly holder: ConversationOwnershipHolder;
	release(): Promise<void>;
}

export interface ConversationOwnershipManager {
	acquire(conversationPath: string): Promise<ConversationOwnershipLease>;
}

export interface FileConversationOwnershipManagerOptions {
	readonly heartbeatIntervalMs?: number;
	readonly staleAfterMs?: number;
	readonly createToken?: () => string;
	readonly now?: () => number;
	readonly pid?: number;
	readonly hostname?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
	readonly readProcessStartedAtMs?: (pid: number) => number | undefined;
}

/**
 * 会话进程级所有权，不参与 Repository 的单次写锁。
 *
 * `.owner.lock` 在 Session 生命周期内持续存在；同机进程通过 PID 判断崩溃遗留，
 * 跨主机或无法解析的锁通过心跳时间回收。
 */
export class FileConversationOwnershipManager implements ConversationOwnershipManager {
	private readonly heartbeatIntervalMs: number;
	private readonly staleAfterMs: number;
	private readonly createToken: () => string;
	private readonly now: () => number;
	private readonly pid: number;
	private readonly hostname: string;
	private readonly isProcessAlive: (pid: number) => boolean;
	private readonly readProcessStartedAtMs: (pid: number) => number | undefined;

	constructor(options: FileConversationOwnershipManagerOptions = {}) {
		this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
		this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
		this.createToken = options.createToken ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.pid = options.pid ?? process.pid;
		this.hostname = options.hostname ?? hostname();
		this.isProcessAlive = options.isProcessAlive ?? isLocalProcessAlive;
		this.readProcessStartedAtMs = options.readProcessStartedAtMs ?? readLocalProcessStartedAtMs;
		if (this.heartbeatIntervalMs <= 0) throw new Error("heartbeatIntervalMs must be greater than zero");
		if (this.staleAfterMs <= this.heartbeatIntervalMs) {
			throw new Error("staleAfterMs must be greater than heartbeatIntervalMs");
		}
	}

	async acquire(conversationPath: string): Promise<ConversationOwnershipLease> {
		const lockPath = `${conversationPath}.owner.lock`;
		const holder: ConversationOwnershipHolder = {
			token: this.createToken(),
			pid: this.pid,
			hostname: this.hostname,
			acquiredAt: new Date(this.now()).toISOString(),
			processStartedAt: new Date(
				this.pid === process.pid
					? currentProcessStartedAtMs()
					: (this.readProcessStartedAtMs(this.pid) ?? this.now()),
			).toISOString(),
		};
		await mkdir(dirname(lockPath), { recursive: true });

		for (let attempt = 0; attempt < ACQUIRE_RACE_RETRY_COUNT; attempt += 1) {
			let handle: FileHandle | undefined;
			try {
				handle = await open(lockPath, "wx");
				await handle.writeFile(JSON.stringify(holder), "utf8");
				await handle.close();
				handle = undefined;
				return this.createLease(conversationPath, lockPath, holder);
			} catch (error) {
				await handle?.close();
				if (nodeErrorCode(error) !== "EEXIST") throw error;
				const existing = await readHolder(lockPath);
				if (!(await this.canReclaim(lockPath, existing))) {
					throw new ConversationOwnershipConflictError(conversationPath, lockPath, existing, { cause: error });
				}
				await rm(lockPath, { force: true });
			}
		}

		throw new ConversationOwnershipConflictError(conversationPath, lockPath, await readHolder(lockPath));
	}

	private createLease(
		conversationPath: string,
		lockPath: string,
		holder: ConversationOwnershipHolder,
	): ConversationOwnershipLease {
		let released = false;
		let releaseOperation: Promise<void> | undefined;
		const heartbeat = setInterval(() => {
			void touchOwnedLock(lockPath, holder.token, this.now()).catch(() => undefined);
		}, this.heartbeatIntervalMs);
		heartbeat.unref();

		return {
			conversationPath,
			lockPath,
			holder,
			release() {
				if (released) return Promise.resolve();
				if (!releaseOperation) {
					releaseOperation = (async () => {
						try {
							await releaseOwnedLock(lockPath, holder.token);
							released = true;
							clearInterval(heartbeat);
						} finally {
							releaseOperation = undefined;
						}
					})();
				}
				return releaseOperation;
			},
		};
	}

	private async canReclaim(lockPath: string, holder: ConversationOwnershipHolder | undefined): Promise<boolean> {
		if (holder?.hostname === this.hostname) {
			if (!this.isProcessAlive(holder.pid)) return true;
			const liveStartedAt = this.readProcessStartedAtMs(holder.pid);
			if (liveStartedAt === undefined) return false;
			const recordedStartedAt = holder.processStartedAt ? Date.parse(holder.processStartedAt) : Number.NaN;
			if (Number.isFinite(recordedStartedAt)) {
				return Math.abs(liveStartedAt - recordedStartedAt) > PROCESS_START_TOLERANCE_MS;
			}
			const acquiredAt = Date.parse(holder.acquiredAt);
			return Number.isFinite(acquiredAt) && liveStartedAt > acquiredAt + PROCESS_START_TOLERANCE_MS;
		}
		try {
			return this.now() - (await stat(lockPath)).mtimeMs >= this.staleAfterMs;
		} catch (error) {
			if (nodeErrorCode(error) === "ENOENT") return true;
			throw error;
		}
	}
}

async function releaseOwnedLock(lockPath: string, holderToken: string): Promise<void> {
	try {
		const current = await readHolder(lockPath);
		if (current?.token === holderToken) await rm(lockPath, { force: true });
	} catch (error) {
		if (nodeErrorCode(error) !== "ENOENT") throw error;
	}
}

async function readHolder(path: string): Promise<ConversationOwnershipHolder | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		return Value.Check(ConversationOwnershipHolderSchema, value) ? value : undefined;
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT" || error instanceof SyntaxError) return undefined;
		throw error;
	}
}

async function touchOwnedLock(path: string, token: string, now: number): Promise<void> {
	if ((await readHolder(path))?.token !== token) return;
	const timestamp = new Date(now);
	await utimes(path, timestamp, timestamp);
}
