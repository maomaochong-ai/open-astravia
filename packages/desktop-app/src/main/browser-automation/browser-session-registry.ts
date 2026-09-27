import { randomUUID } from "node:crypto";
import { BrowserAutomationError } from "./contracts.js";

const EXCLUSIVE_LOCK_WAIT_MS = 30_000;

interface QueuedOperation<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

/**
 * 每 (namespace + sessionId) 维护一个 exclusive 队列，保证同一会话的操作序列化。
 * persistent profile 维度还额外维护互斥锁：同 profile.id 不能被两个会话同时占用。
 */
export class BrowserSessionRegistry {
	private readonly sessionQueues = new Map<string, QueuedOperation<unknown>>();
	private readonly profileLocks = new Map<string, string>(); // profileId → sessionId

	async runExclusive<T>(namespace: string, sessionId: string, operation: () => Promise<T>): Promise<T> {
		const key = `${namespace}:${sessionId}`;
		const result = this.enqueue<T>(key, operation);
		const timeout = setTimeout(() => {
			const pending = this.sessionQueues.get(key);
			if (pending) pending.reject(new Error("Session exclusive lock timeout"));
		}, EXCLUSIVE_LOCK_WAIT_MS);
		try {
			return await result;
		} finally {
			clearTimeout(timeout);
		}
	}

	async runPersistentProfileExclusive<T>(
		profileId: string,
		_namespace: string,
		sessionId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const currentHolder = this.profileLocks.get(profileId);
		if (currentHolder && currentHolder !== sessionId) {
			throw new BrowserAutomationError(
				"profile_locked",
				`Persistent profile "${profileId}" is in use by session "${currentHolder}"`,
			);
		}
		this.profileLocks.set(profileId, sessionId);
		try {
			return await operation();
		} finally {
			const holder = this.profileLocks.get(profileId);
			if (holder === sessionId) this.profileLocks.delete(profileId);
		}
	}

	releaseSession(_namespace: string, _sessionId: string): void {
		// exclusive 队列由 runExclusive 自己释放（resolve/reject 后 dequeue）。
		// persistent profile 锁同理。此处留空占位，未来如需强制清理可在此扩展。
	}

	private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
		return new Promise<T>((outerResolve, outerReject) => {
			const prev = this.sessionQueues.get(key);
			let resolve: (value: unknown) => void;
			let reject: (reason?: unknown) => void;
			const promise = new Promise<unknown>((res, rej) => {
				resolve = res;
				reject = rej;
			});
			const entry: QueuedOperation<unknown> = { promise, resolve: resolve!, reject: reject! };
			this.sessionQueues.set(key, entry);
			(async () => {
				try {
					if (prev) await prev.promise;
					const value = await operation();
					outerResolve(value);
					entry.resolve(value);
				} catch (error) {
					outerReject(error);
					entry.reject(error);
				} finally {
					const current = this.sessionQueues.get(key);
					if (current === entry) this.sessionQueues.delete(key);
				}
			})();
		});
	}
}

export function generateSessionId(workspaceRootHash?: string): string {
	const suffix = workspaceRootHash ?? randomUUID().replace(/-/g, "");
	return `astravia-${suffix}`;
}
