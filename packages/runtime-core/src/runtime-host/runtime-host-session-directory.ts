import { runtimeError } from "../errors.js";
import type { RuntimeHostSessionRecord } from "./types.js";

export interface RuntimeHostSessionIdentityRebind {
	readonly sessionKey: string;
	readonly previousSessionId: string;
	readonly nextSessionId: string;
}

export interface RuntimeHostSessionDirectoryRemoval {
	readonly sessionKey: string;
	readonly canonicalSessionId: string;
	readonly identities: readonly string[];
}

/**
 * RuntimeHost 活动 Session 的唯一内存索引。
 *
 * stable key 只用于 Host 内部资源所有权；持久化 continuation 可以改变 canonical
 * Session ID，旧 ID 在 Session 存活期间保留为 alias。该对象只管理索引，不创建或
 * 释放 Session，也不产生 I/O 或 Observation。
 */
export class RuntimeHostSessionDirectory {
	private readonly sessions = new Map<string, RuntimeHostSessionRecord>();
	private readonly sessionKeysByIdentity = new Map<string, string>();
	private readonly currentSessionIdentityByKey = new Map<string, string>();

	constructor(private readonly normalizePath: (path: string) => string = (path) => path) {}

	register(sessionId: string, handle: RuntimeHostSessionRecord): string {
		if (this.sessionKeysByIdentity.has(sessionId) || this.sessions.has(sessionId)) {
			throw new Error(`RuntimeHost Session id is already registered: ${sessionId}`);
		}
		this.sessions.set(sessionId, handle);
		this.sessionKeysByIdentity.set(sessionId, sessionId);
		this.currentSessionIdentityByKey.set(sessionId, sessionId);
		return sessionId;
	}

	hasIdentity(sessionId: string): boolean {
		return this.sessionKeysByIdentity.has(sessionId) || this.sessions.has(sessionId);
	}

	findBySessionPath(
		sessionPath: string,
	): { sessionKey: string; sessionId: string; handle: RuntimeHostSessionRecord } | undefined {
		const target = this.normalizePath(sessionPath);
		for (const [sessionKey, handle] of this.sessions) {
			const openPath = handle.lifecycle.sessionPath;
			if (openPath && this.normalizePath(openPath) === target) {
				return {
					sessionKey,
					sessionId: this.currentSessionIdentityByKey.get(sessionKey) ?? handle.lifecycle.sessionId,
					handle,
				};
			}
		}
		return undefined;
	}

	readCanonicalSessionId(sessionId: string): string {
		const sessionKey = this.sessionKeysByIdentity.get(sessionId);
		return sessionKey ? (this.currentSessionIdentityByKey.get(sessionKey) ?? sessionId) : sessionId;
	}

	resolveSessionKey(sessionId: string): string {
		const sessionKey = this.sessionKeysByIdentity.get(sessionId) ?? sessionId;
		if (!this.sessions.has(sessionKey)) {
			throw runtimeError("SESSION_NOT_FOUND", `Session not found: ${sessionId}`, false);
		}
		return sessionKey;
	}

	get(sessionId: string): RuntimeHostSessionRecord {
		return this.sessions.get(this.resolveSessionKey(sessionId))!;
	}

	getByKey(sessionKey: string): RuntimeHostSessionRecord | undefined {
		return this.sessions.get(sessionKey);
	}

	isRegisteredOwner(sessionKey: string, handle: RuntimeHostSessionRecord): boolean {
		return this.sessions.get(sessionKey) === handle;
	}

	readCanonicalSessionIdByKey(sessionKey: string, fallback: string): string {
		return this.currentSessionIdentityByKey.get(sessionKey) ?? fallback;
	}

	hasKey(sessionKey: string): boolean {
		return this.sessions.has(sessionKey);
	}

	keys(): IterableIterator<string> {
		return this.sessions.keys();
	}

	values(): IterableIterator<RuntimeHostSessionRecord> {
		return this.sessions.values();
	}

	entries(): IterableIterator<[string, RuntimeHostSessionRecord]> {
		return this.sessions.entries();
	}

	synchronizeIdentity(
		sessionKey: string,
		handle: RuntimeHostSessionRecord,
	): RuntimeHostSessionIdentityRebind | undefined {
		if (this.sessions.get(sessionKey) !== handle) return undefined;
		const nextSessionId = handle.lifecycle.sessionId;
		const previousSessionId = this.currentSessionIdentityByKey.get(sessionKey) ?? sessionKey;
		if (nextSessionId === previousSessionId) return undefined;
		const conflictingKey = this.sessionKeysByIdentity.get(nextSessionId);
		if (conflictingKey !== undefined && conflictingKey !== sessionKey) {
			throw runtimeError(
				"INVALID_REQUEST",
				`RuntimeHost Session identity is already registered: ${nextSessionId}`,
				false,
				"runtime",
			);
		}
		this.sessionKeysByIdentity.set(nextSessionId, sessionKey);
		this.currentSessionIdentityByKey.set(sessionKey, nextSessionId);
		return Object.freeze({ sessionKey, previousSessionId, nextSessionId });
	}

	remove(
		sessionKey: string,
		expectedHandle: RuntimeHostSessionRecord,
	): RuntimeHostSessionDirectoryRemoval | undefined {
		if (this.sessions.get(sessionKey) !== expectedHandle) return undefined;
		const canonicalSessionId = this.currentSessionIdentityByKey.get(sessionKey) ?? expectedHandle.lifecycle.sessionId;
		const identities: string[] = [];
		this.sessions.delete(sessionKey);
		this.currentSessionIdentityByKey.delete(sessionKey);
		for (const [identity, key] of this.sessionKeysByIdentity) {
			if (key !== sessionKey) continue;
			identities.push(identity);
			this.sessionKeysByIdentity.delete(identity);
		}
		return Object.freeze({ sessionKey, canonicalSessionId, identities: Object.freeze(identities) });
	}
}
