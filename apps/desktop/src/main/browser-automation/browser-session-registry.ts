import { randomUUID } from "node:crypto";
import type { BrowserSession, BrowserSessionProfile, BrowserSource } from "@vetta/capability-sdk";
import type { BrowserSessionRecord, BrowserSessionResources } from "./contracts.js";
import { BrowserAutomationError } from "./contracts.js";

interface ManagedBrowserSessionRecord extends BrowserSessionRecord {
	operationTail: Promise<void>;
}

export class BrowserSessionRegistry {
	private readonly records = new Map<string, ManagedBrowserSessionRecord>();
	private readonly profileOperationTails = new Map<string, Promise<void>>();

	create(input: {
		namespace: string;
		source: BrowserSource;
		profile: BrowserSessionProfile;
		headed: boolean;
		allowedHosts: readonly string[];
		resources: BrowserSessionResources;
		sessionId?: string;
	}): BrowserSessionRecord {
		const session: BrowserSession = {
			id: input.sessionId ?? `vetta-${randomUUID()}`,
			source: input.source,
			profile: input.profile,
			headed: input.headed,
			status: "ready",
			createdAt: Date.now(),
		};
		const record: ManagedBrowserSessionRecord = {
			namespace: input.namespace,
			session,
			allowedHosts: [...input.allowedHosts],
			revision: 0,
			currentUrl: "about:blank",
			resources: input.resources,
			operationTail: Promise.resolve(),
		};
		this.records.set(session.id, record);
		return record;
	}

	get(namespace: string, sessionId: string): BrowserSessionRecord {
		const record = this.records.get(sessionId);
		if (!record) throw new BrowserAutomationError("session_not_found", "Browser session was not found");
		if (record.namespace !== namespace) {
			throw new BrowserAutomationError("session_forbidden", "Browser session belongs to another namespace");
		}
		return record;
	}

	findPersistentProfile(namespace: string, profileId: string): BrowserSessionRecord | undefined {
		return [...this.records.values()].find(
			(record) =>
				record.namespace === namespace &&
				record.session.profile.type === "persistent" &&
				record.session.profile.id === profileId,
		);
	}

	async runExclusive<T>(
		namespace: string,
		sessionId: string,
		operation: (record: BrowserSessionRecord) => Promise<T>,
	): Promise<T> {
		const record = this.get(namespace, sessionId) as ManagedBrowserSessionRecord;
		let release: () => void = () => undefined;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = record.operationTail;
		record.operationTail = previous.catch(() => undefined).then(() => next);
		await previous.catch(() => undefined);
		try {
			return await operation(record);
		} finally {
			release();
		}
	}

	async runPersistentProfileExclusive<T>(
		namespace: string,
		profileId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const key = JSON.stringify([namespace, profileId]);
		const previous = this.profileOperationTails.get(key) ?? Promise.resolve();
		let release: () => void = () => undefined;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => current);
		this.profileOperationTails.set(key, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.profileOperationTails.get(key) === tail) this.profileOperationTails.delete(key);
		}
	}

	delete(namespace: string, sessionId: string): BrowserSessionRecord {
		const record = this.get(namespace, sessionId);
		this.records.delete(sessionId);
		return record;
	}

	list(): readonly BrowserSessionRecord[] {
		return [...this.records.values()];
	}
}
