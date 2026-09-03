import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";

const CATALOG_PATH = resolve(getVettaHomePath(), "conversation-ownership.v1.json");

export type ConversationOwner = {
	readonly kind: "agent-team";
	readonly teamId: string;
	readonly teamSessionId: string;
	readonly role: "coordination" | "member";
};

export interface ConversationOwnershipRecord {
	readonly sessionPath: string;
	readonly owner: ConversationOwner;
	readonly title: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

interface ConversationOwnershipDocument {
	readonly schemaVersion: 1;
	readonly records: readonly ConversationOwnershipRecord[];
}

export interface ConversationOwnershipCatalogPort {
	register(records: readonly ConversationOwnershipRecord[]): Promise<void>;
	listByTeam(teamId: string): Promise<readonly ConversationOwnershipRecord[]>;
	getOwner(sessionPath: string): Promise<ConversationOwner | undefined>;
	filterUserSessions<T extends { readonly path: string }>(sessions: readonly T[]): Promise<T[]>;
}

/**
 * Product ownership index above the runtime Conversation store.
 * Conversation files and runtime catalogs stay product-neutral; callers decide which owner view to expose.
 */
export class ConversationOwnershipCatalog implements ConversationOwnershipCatalogPort {
	private mutationTail: Promise<void> = Promise.resolve();

	constructor(private readonly path = CATALOG_PATH) {}

	register(records: readonly ConversationOwnershipRecord[]): Promise<void> {
		if (records.length === 0) return Promise.resolve();
		const operation = this.mutationTail
			.catch(() => undefined)
			.then(async () => {
				const current = await this.read();
				const byPath = new Map(
					current.records.map((record) => [conversationOwnershipPathKey(record.sessionPath), record]),
				);
				for (const record of records) {
					byPath.set(conversationOwnershipPathKey(record.sessionPath), cloneRecord(record));
				}
				await atomicWriteJSONAsync(this.path, {
					schemaVersion: 1,
					records: [...byPath.values()],
				} satisfies ConversationOwnershipDocument);
			});
		this.mutationTail = operation;
		return operation;
	}

	async listByTeam(teamId: string): Promise<readonly ConversationOwnershipRecord[]> {
		return (await this.read()).records.filter((record) => record.owner.teamId === teamId).map(cloneRecord);
	}

	async getOwner(sessionPath: string): Promise<ConversationOwner | undefined> {
		const key = conversationOwnershipPathKey(sessionPath);
		const record = (await this.read()).records.find(
			(candidate) => conversationOwnershipPathKey(candidate.sessionPath) === key,
		);
		return record ? { ...record.owner } : undefined;
	}

	async filterUserSessions<T extends { readonly path: string }>(sessions: readonly T[]): Promise<T[]> {
		if (sessions.length === 0) return [];
		const owned = new Set(
			(await this.read()).records.map((record) => conversationOwnershipPathKey(record.sessionPath)),
		);
		return sessions.filter((session) => !owned.has(conversationOwnershipPathKey(session.path)));
	}

	private async read(): Promise<ConversationOwnershipDocument> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
			return parseDocument(parsed);
		} catch (error) {
			if (isMissingFile(error)) return { schemaVersion: 1, records: [] };
			throw error;
		}
	}
}

export const conversationOwnershipCatalog = new ConversationOwnershipCatalog();

function parseDocument(value: unknown): ConversationOwnershipDocument {
	if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) {
		throw new Error("Invalid Conversation ownership catalog");
	}
	return {
		schemaVersion: 1,
		records: value.records.map((record) => {
			if (
				!isRecord(record) ||
				typeof record.sessionPath !== "string" ||
				typeof record.title !== "string" ||
				typeof record.createdAt !== "number" ||
				typeof record.updatedAt !== "number" ||
				!isRecord(record.owner) ||
				record.owner.kind !== "agent-team" ||
				typeof record.owner.teamId !== "string" ||
				typeof record.owner.teamSessionId !== "string" ||
				(record.owner.role !== "coordination" && record.owner.role !== "member")
			) {
				throw new Error("Invalid Conversation ownership record");
			}
			return record as unknown as ConversationOwnershipRecord;
		}),
	};
}

function cloneRecord(record: ConversationOwnershipRecord): ConversationOwnershipRecord {
	return { ...record, owner: { ...record.owner } };
}

export function conversationOwnershipPathKey(path: string): string {
	const absolute = resolve(path);
	return process.platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}
