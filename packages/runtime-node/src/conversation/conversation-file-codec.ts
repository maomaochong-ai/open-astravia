import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	assertConversationDocumentGraph,
	type ConversationDocument,
	type ConversationDocumentEntry,
	type ConversationDocumentEntryReference,
	conversationDocumentEntryPersistence,
	createEmptyConversationDocument,
	createSeededConversationDocument,
	nativeConversationEntryId,
	selectConversationDocumentModelMessages,
} from "@astravia/runtime-core/conversation";
import type { StoredConversation, StoredSessionEvent } from "@astravia/runtime-core/kernel";
import {
	CONVERSATION_SCHEMA_VERSION,
	CONVERSATION_STORAGE_ERROR_CODES,
	type ConversationContinuationSeedRecord,
	type ConversationDocumentOperationRecord,
	type ConversationEventRecord,
	type ConversationFileHeader,
	type ConversationImportSeedRecord,
	type ConversationSeedRecord,
	ConversationStorageError,
	getStoredSessionEventValidationIssue,
	isConversationContinuationSeedRecord,
	isConversationDocumentOperationRecord,
	isConversationFileHeader,
	isConversationImportSeedRecord,
	isConversationSeedRecord,
	isStoredSessionEvent,
	type NormalizedReadConversationEventRecord,
	type ReadConversationFileHeader,
	readConversationEventRecord,
} from "@astravia/runtime-storage/conversation";

type ConversationBodyRecord = NormalizedReadConversationEventRecord | ConversationDocumentOperationRecord;

export interface ParsedConversationFile {
	readonly header: ReadConversationFileHeader;
	readonly seed?: ConversationSeedRecord;
	readonly continuationSeed?: ConversationContinuationSeedRecord;
	readonly importSeed?: ConversationImportSeedRecord;
	readonly records: readonly ConversationBodyRecord[];
	readonly eventRecords: readonly NormalizedReadConversationEventRecord[];
}

/**
 * 会话文件的增量解析状态。
 *
 * 会话文件是只追加的 JSONL：桌面端长会话可达数十 MB，而每次文档命令都要读取全文。
 * 累加器让调用方只在文件增长时解析新增的行，一次落盘后无需重新解析整份历史。
 */
export interface ConversationFileParseAccumulator {
	header: ReadConversationFileHeader | undefined;
	seed: ConversationSeedRecord | undefined;
	continuationSeed: ConversationContinuationSeedRecord | undefined;
	importSeed: ConversationImportSeedRecord | undefined;
	readonly records: ConversationBodyRecord[];
	readonly eventRecords: NormalizedReadConversationEventRecord[];
	readonly documentEntryIds: Set<string>;
	expectedEventSequence: number;
	bodyCount: number;
}

export function createConversationFileParseAccumulator(): ConversationFileParseAccumulator {
	return {
		header: undefined,
		seed: undefined,
		continuationSeed: undefined,
		importSeed: undefined,
		records: [],
		eventRecords: [],
		documentEntryIds: new Set<string>(),
		expectedEventSequence: 1,
		bodyCount: 0,
	};
}

export function parseConversationFile(text: string, sessionId: string): ParsedConversationFile {
	const accumulator = createConversationFileParseAccumulator();
	appendConversationFileText(accumulator, text, sessionId);
	return conversationFileFromAccumulator(accumulator, sessionId);
}

/**
 * 把一段以换行结尾的完整记录追加进累加器；跨行不变量（序号、重复 id）沿用原有校验。
 */
export function appendConversationFileText(
	accumulator: ConversationFileParseAccumulator,
	text: string,
	sessionId: string,
): void {
	if (text.length === 0) return;
	// 没有文件头时本段从第 1 行开始；有头时已经消费过“头 + bodyCount 条记录”。
	const startLine = accumulator.header === undefined ? 1 : accumulator.bodyCount + 2;
	const parsed = parseRecords(text, sessionId, startLine);
	let body = parsed;
	if (!accumulator.header) {
		const [header, ...rest] = parsed;
		if (!isConversationFileHeader(header) || header.sessionId !== sessionId) {
			throw corruptConversation(sessionId, "missing or mismatched header");
		}
		accumulator.header = header;
		body = rest;
	}
	appendConversationFileRecords(accumulator, body, sessionId);
}

function appendConversationFileRecords(
	accumulator: ConversationFileParseAccumulator,
	body: readonly unknown[],
	sessionId: string,
): void {
	const header = accumulator.header;
	if (!header) throw corruptConversation(sessionId, "missing or mismatched header");
	const base = accumulator.bodyCount;
	for (let local = 0; local < body.length; local += 1) {
		const index = base + local;
		const record = body[local];
		if (isConversationSeedRecord(record)) {
			if (
				header.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
				index !== 0 ||
				accumulator.seed ||
				accumulator.continuationSeed ||
				accumulator.importSeed
			) {
				throw corruptConversation(sessionId, `invalid seed at line ${index + 2}`);
			}
			accumulator.seed = record;
			for (const entry of record.entries) {
				if (accumulator.documentEntryIds.has(entry.id)) {
					throw corruptConversation(sessionId, `duplicate seed entry at line ${index + 2}`);
				}
				accumulator.documentEntryIds.add(entry.id);
			}
			continue;
		}
		if (isConversationContinuationSeedRecord(record)) {
			if (
				header.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
				index !== 0 ||
				accumulator.seed ||
				accumulator.continuationSeed ||
				accumulator.importSeed ||
				header.parentSessionPath !== record.sourceSessionPath ||
				header.parentEntryId !== record.sourceEntryId
			) {
				throw corruptConversation(sessionId, `invalid continuation seed at line ${index + 2}`);
			}
			accumulator.continuationSeed = record;
			for (const entry of record.entries) {
				if (accumulator.documentEntryIds.has(entry.id)) {
					throw corruptConversation(sessionId, `duplicate continuation entry at line ${index + 2}`);
				}
				accumulator.documentEntryIds.add(entry.id);
			}
			continue;
		}
		if (isConversationImportSeedRecord(record)) {
			if (
				header.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
				index !== 0 ||
				accumulator.seed ||
				accumulator.continuationSeed ||
				accumulator.importSeed
			) {
				throw corruptConversation(sessionId, `invalid import seed at line ${index + 2}`);
			}
			accumulator.importSeed = record;
			for (const entry of record.entries) {
				if (accumulator.documentEntryIds.has(entry.id)) {
					throw corruptConversation(sessionId, `duplicate import entry at line ${index + 2}`);
				}
				accumulator.documentEntryIds.add(entry.id);
			}
			continue;
		}
		if (isConversationDocumentOperationRecord(record)) {
			if (header.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
				throw corruptConversation(sessionId, `document operation is not supported at line ${index + 2}`);
			}
			const entryId = documentOperationEntryId(record);
			if (entryId) {
				if (accumulator.documentEntryIds.has(entryId)) {
					throw corruptConversation(sessionId, `duplicate document entry at line ${index + 2}`);
				}
				accumulator.documentEntryIds.add(entryId);
			}
			accumulator.records.push(record);
			continue;
		}
		const eventRecord = readConversationEventRecord(record);
		if (!eventRecord) {
			throw corruptConversation(sessionId, `invalid conversation record at line ${index + 2}`);
		}
		if (eventRecord.schemaVersion !== header.schemaVersion) {
			throw corruptConversation(sessionId, `event schema version does not match header at line ${index + 2}`);
		}
		if (eventRecord.sequence !== accumulator.expectedEventSequence) {
			throw corruptConversation(
				sessionId,
				`event sequence ${eventRecord.sequence} does not match expected ${accumulator.expectedEventSequence}`,
			);
		}
		accumulator.expectedEventSequence += 1;
		validateConversationEvent(sessionId, eventRecord.event);
		if (eventRecord.schemaVersion === CONVERSATION_SCHEMA_VERSION) {
			const persistence = conversationDocumentEntryPersistence(eventRecord.event);
			if ((eventRecord.documentEntry !== null) !== (persistence === "reference")) {
				throw corruptConversation(sessionId, `event has inconsistent document entry at line ${index + 2}`);
			}
			if (eventRecord.documentEntry) {
				if (accumulator.documentEntryIds.has(eventRecord.documentEntry.id)) {
					throw corruptConversation(sessionId, `duplicate document entry at line ${index + 2}`);
				}
				if (
					eventRecord.documentEntry.parentId &&
					!accumulator.documentEntryIds.has(eventRecord.documentEntry.parentId)
				) {
					throw corruptConversation(sessionId, `unknown document parent at line ${index + 2}`);
				}
				accumulator.documentEntryIds.add(eventRecord.documentEntry.id);
			}
			// 隐式节点的 id 不落盘，但同样会成为后续事件的父节点，必须一并登记。
			if (persistence === "implicit") {
				const implicitId = nativeConversationEntryId(eventRecord.sequence);
				if (accumulator.documentEntryIds.has(implicitId)) {
					throw corruptConversation(sessionId, `duplicate document entry at line ${index + 2}`);
				}
				accumulator.documentEntryIds.add(implicitId);
			}
		}
		accumulator.eventRecords.push(eventRecord);
		accumulator.records.push(eventRecord);
	}
	accumulator.bodyCount = base + body.length;
}

export function conversationFileFromAccumulator(
	accumulator: ConversationFileParseAccumulator,
	sessionId: string,
): ParsedConversationFile {
	const header = accumulator.header;
	if (!header) throw corruptConversation(sessionId, "missing or mismatched header");
	const { seed, continuationSeed, importSeed } = accumulator;
	return {
		header,
		...withInitialSeed(seed, continuationSeed, importSeed, sessionId),
		records: accumulator.records,
		eventRecords: accumulator.eventRecords,
	};
}

const validatedSeedGraphs = new WeakSet<object>();

/**
 * 种子图只由首个种子记录决定。记录对象在一次解析内恒定，按对象记住校验结果就能做到
 * “校验一次”，而不是每次投影都重跑一遍 O(entries) 的图校验。
 */
function withInitialSeed(
	seed: ConversationSeedRecord | undefined,
	continuationSeed: ConversationContinuationSeedRecord | undefined,
	importSeed: ConversationImportSeedRecord | undefined,
	sessionId: string,
): {
	seed?: ConversationSeedRecord;
	continuationSeed?: ConversationContinuationSeedRecord;
	importSeed?: ConversationImportSeedRecord;
} {
	const initialSeed = seed ?? continuationSeed ?? importSeed;
	if (initialSeed && !validatedSeedGraphs.has(initialSeed)) {
		try {
			assertConversationDocumentGraph(
				initialSeed.entries as readonly ConversationDocumentEntry[],
				initialSeed.activeLeafId,
			);
		} catch (error) {
			throw corruptConversation(sessionId, "invalid conversation seed graph", error);
		}
		validatedSeedGraphs.add(initialSeed);
	}
	return {
		...(seed === undefined ? {} : { seed }),
		...(continuationSeed === undefined ? {} : { continuationSeed }),
		...(importSeed === undefined ? {} : { importSeed }),
	};
}

function documentOperationEntryId(record: ConversationDocumentOperationRecord): string | undefined {
	switch (record.command.type) {
		case "branch_summary.append":
		case "custom.append":
		case "entry.label.set":
			return record.command.entryId;
		default:
			return undefined;
	}
}

export function validateConversationEvent(sessionId: string, event: StoredSessionEvent): void {
	if (!isStoredSessionEvent(event)) {
		const issue = getStoredSessionEventValidationIssue(event);
		const eventLabel = issue?.eventType ? ` ${issue.eventType}` : "";
		const diagnostic = issue ? ` at ${issue.path}: ${issue.message}` : "";
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT,
			`Stored${eventLabel} event for ${sessionId} does not match the schema${diagnostic}`,
		);
	}
	if (event.sessionId !== sessionId) {
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT,
			`Event session ${event.sessionId} does not match ${sessionId}`,
		);
	}
}

export function encodeConversationSessionId(sessionId: string): string {
	return Buffer.from(sessionId, "utf8").toString("base64url");
}

export function serializeConversationLine(
	value:
		| ConversationFileHeader
		| ConversationEventRecord
		| NormalizedReadConversationEventRecord
		| ConversationContinuationSeedRecord
		| ConversationImportSeedRecord
		| ConversationSeedRecord
		| ConversationDocumentOperationRecord,
): string {
	return `${JSON.stringify(value)}\n`;
}

export function conversationFromFile(
	sessionId: string,
	file: ParsedConversationFile,
	document?: ConversationDocument,
): StoredConversation {
	const events = file.eventRecords.map((record) => record.event);
	const projected = document ?? documentFromFile(sessionId, file);
	return {
		sessionId,
		createdAt: file.header.createdAt,
		version: events.length,
		messages: selectConversationDocumentModelMessages(projected),
		events,
	};
}

export function documentFromFile(sessionId: string, file: ParsedConversationFile): ConversationDocument {
	return applyConversationRecords(sessionId, initialConversationDocument(sessionId, file), file.records);
}

/**
 * 只由文件头与种子决定文档初始状态；后续记录通过 applyConversationRecords 叠加。
 */
export function initialConversationDocument(
	sessionId: string,
	file: Pick<ParsedConversationFile, "header" | "seed" | "continuationSeed" | "importSeed">,
): ConversationDocument {
	const identity = {
		sessionId,
		createdAt: file.header.createdAt,
		...(file.header.schemaVersion === CONVERSATION_SCHEMA_VERSION
			? {
					agentId: file.header.agentId,
					cwd: file.header.cwd,
					parentSessionPath: file.header.parentSessionPath,
					parentEntryId: file.header.parentEntryId,
				}
			: {}),
	};
	const initialSeed = file.seed ?? file.continuationSeed ?? file.importSeed;
	let document = initialSeed
		? createSeededConversationDocument(
				identity,
				initialSeed.entries as readonly ConversationDocumentEntry[],
				initialSeed.activeLeafId,
			)
		: createEmptyConversationDocument(identity);
	const seedName = file.seed?.name ?? file.importSeed?.name;
	if (seedName !== undefined) {
		document = { ...document, name: seedName };
	}
	return document;
}

/**
 * 文档投影是记录上的纯折叠，因此可以从已有投影只叠加新记录。
 */
export function applyConversationRecords(
	sessionId: string,
	document: ConversationDocument,
	records: readonly ConversationBodyRecord[],
): ConversationDocument {
	if (records.length === 0) return document;
	try {
		let projected = document;
		for (const record of records) {
			if (record.recordType === "conversation.event") {
				const reference = record.schemaVersion === CONVERSATION_SCHEMA_VERSION ? record.documentEntry : undefined;
				projected = applyStoredEventToConversationDocument(
					projected,
					record.event,
					record.sequence,
					reference ?? undefined,
				);
				continue;
			}
			const result = applyConversationDocumentCommand(projected, record.command, record.revision);
			if (!result.changed) throw new Error(`Document operation ${record.revision} is a persisted no-op`);
			projected = result.document;
		}
		return projected;
	} catch (error) {
		throw corruptConversation(sessionId, "invalid conversation document projection", error);
	}
}

export function createDocumentEntryReference(
	event: StoredSessionEvent,
	sequence: number,
	parentId: string | null,
): ConversationDocumentEntryReference | null {
	if (conversationDocumentEntryPersistence(event) !== "reference") return null;
	return {
		id: nativeConversationEntryId(sequence),
		parentId,
		timestamp: new Date(event.timestamp).toISOString(),
	};
}

function parseRecords(text: string, sessionId: string, startLine: number): unknown[] {
	if (!text.endsWith("\n")) {
		throw corruptConversation(sessionId, "file does not end with a complete record");
	}
	const lines = text.slice(0, -1).split(/\r?\n/);
	const empty = lines.findIndex((line) => line.length === 0);
	if (empty >= 0) {
		throw corruptConversation(sessionId, `file contains an empty record at line ${startLine + empty}`);
	}
	return lines.map((line, index) => {
		try {
			const parsed: unknown = JSON.parse(line);
			return parsed;
		} catch (error) {
			// 行号必须是文件里的绝对行号：增量解析每次只看新增的一段，局部行号会把用户引错位置。
			throw corruptConversation(sessionId, `invalid JSON at line ${startLine + index}`, error);
		}
	});
}

function corruptConversation(sessionId: string, details: string, cause?: unknown): ConversationStorageError {
	return new ConversationStorageError(
		CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
		`Conversation ${sessionId} is corrupt: ${details}`,
		cause === undefined ? undefined : { cause },
	);
}
