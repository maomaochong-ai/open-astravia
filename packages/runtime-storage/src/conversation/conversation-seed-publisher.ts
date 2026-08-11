import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ConversationDocument, ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import {
	documentFromFile,
	encodeConversationSessionId,
	parseConversationFile,
	serializeConversationLine,
} from "./conversation-file-codec.js";
import { publishConversationFileExclusive } from "./conversation-file-publisher.js";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "./errors.js";
import { nodeErrorCode } from "./node-error-code.js";
import {
	CONVERSATION_SCHEMA_VERSION,
	type ConversationFileHeader,
	type ConversationSeedRecord,
	isConversationSeedRecord,
} from "./record-schema.js";

export interface ConversationSeedPublicationOptions {
	readonly targetRootDir: string;
	readonly targetSessionId: string;
	readonly createdAt: number;
	readonly cwd?: string;
	readonly parentSessionPath?: string;
	readonly parentEntryId?: string;
	readonly entries: readonly ConversationDocumentEntry[];
	readonly activeLeafId: string | null;
	readonly name?: string;
}

export interface ConversationSeedPublicationResult {
	readonly targetPath: string;
	readonly targetSessionId: string;
	readonly document: ConversationDocument;
}

export interface ConversationSeedSnapshot {
	readonly entries: readonly ConversationDocumentEntry[];
	readonly activeLeafId: string | null;
	readonly name?: string;
}

export interface ConversationSeedDraft {
	readonly targetPath: string;
	update(snapshot: ConversationSeedSnapshot): ConversationDocument;
}

export type ConversationSeedDraftOptions = Omit<
	ConversationSeedPublicationOptions,
	"entries" | "activeLeafId" | "name"
>;

export function resolveConversationFilePath(rootDir: string, sessionId: string): string {
	return join(resolve(rootDir), `${encodeConversationSessionId(sessionId)}.conversation.jsonl`);
}

/** Atomically publishes a native V2 conversation from a validated structured seed. */
export async function publishConversationSeed(
	options: ConversationSeedPublicationOptions,
): Promise<ConversationSeedPublicationResult> {
	const targetRootDir = resolve(options.targetRootDir);
	const publication = createConversationSeedPublication({ ...options, targetRootDir });

	await mkdir(targetRootDir, { recursive: true });
	try {
		await publishConversationFileExclusive(publication.targetPath, publication.content);
	} catch (error) {
		if (nodeErrorCode(error) === "EEXIST") {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
				`Conversation already exists: ${options.targetSessionId}`,
				{ cause: error },
			);
		}
		throw error;
	}

	return {
		targetPath: publication.targetPath,
		targetSessionId: options.targetSessionId,
		document: publication.document,
	};
}

/** Creates a persisted native seed before a synchronous Extension setup callback starts. */
export async function createConversationSeedDraft(
	options: ConversationSeedDraftOptions,
): Promise<ConversationSeedDraft> {
	const initial = await publishConversationSeed({ ...options, entries: [], activeLeafId: null });
	return {
		targetPath: initial.targetPath,
		update(snapshot) {
			const publication = createConversationSeedPublication({ ...options, ...snapshot });
			replaceConversationSeedDraft(publication.targetPath, publication.content);
			return publication.document;
		},
	};
}

function replaceConversationSeedDraft(targetPath: string, content: string): void {
	const temporaryPath = `${targetPath}.${randomUUID()}.draft.tmp`;
	try {
		writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
		renameSync(temporaryPath, targetPath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function createConversationSeedPublication(options: ConversationSeedPublicationOptions): {
	readonly targetPath: string;
	readonly content: string;
	readonly document: ConversationDocument;
} {
	const targetPath = resolveConversationFilePath(options.targetRootDir, options.targetSessionId);
	const header: ConversationFileHeader = {
		recordType: "conversation.header",
		schemaVersion: CONVERSATION_SCHEMA_VERSION,
		sessionId: options.targetSessionId,
		createdAt: options.createdAt,
		...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
		...(options.parentSessionPath !== undefined ? { parentSessionPath: options.parentSessionPath } : {}),
		...(options.parentEntryId !== undefined ? { parentEntryId: options.parentEntryId } : {}),
	};
	const seedCandidate: unknown = {
		recordType: "conversation.seed",
		schemaVersion: CONVERSATION_SCHEMA_VERSION,
		entries: options.entries,
		activeLeafId: options.activeLeafId,
		...(options.name !== undefined ? { name: options.name } : {}),
	};
	if (!isConversationSeedRecord(seedCandidate)) {
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
			`Conversation seed ${options.targetSessionId} does not match the V2 schema`,
		);
	}
	const seed: ConversationSeedRecord = seedCandidate;
	const content = [serializeConversationLine(header), serializeConversationLine(seed)].join("");
	const document = documentFromFile(options.targetSessionId, parseConversationFile(content, options.targetSessionId));
	return { targetPath, content, document };
}
