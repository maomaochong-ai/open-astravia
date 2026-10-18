import { randomUUID } from "node:crypto";
import { appendFile, type FileHandle, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	type ConversationDocumentCommand,
	type ConversationDocumentCommandResult,
	type ConversationDocumentEntry,
	type ConversationDocumentForkResult,
	type ConversationDocumentStore,
	conversationDocumentEntry,
	createEmptyConversationDocument,
	createSeededConversationDocument,
	extractConversationEntryText,
	resolveConversationUserTurnTip,
	selectConversationDocumentEntries,
	selectConversationDocumentModelMessages,
} from "@astravia/runtime-core/conversation";
import {
	type AppendResult,
	type ContinueConversationInput,
	type ConversationContinuationResult,
	type ConversationContinuationStore,
	type ConversationMetadata,
	type ConversationRepository,
	type ConversationSnapshot,
	type CreateConversationInput,
	FailInterruptedTurnRecoveryPolicy,
	type StoredConversation,
	type StoredSessionEvent,
} from "@astravia/runtime-core/kernel";
import {
	CONVERSATION_SCHEMA_VERSION,
	CONVERSATION_STORAGE_ERROR_CODES,
	type ConversationContinuationSeedRecord,
	type ConversationDocumentOperationRecord,
	type ConversationEventRecord,
	type ConversationFileHeader,
	type ConversationSnapshotRecord,
	ConversationStorageError,
	isConversationContinuationSeedRecord,
	isConversationDocumentCommand,
	isConversationSnapshot,
} from "@astravia/runtime-storage/conversation";
import {
	appendConversationFileText,
	applyConversationRecords,
	type ConversationFileParseAccumulator,
	conversationFileFromAccumulator,
	conversationFromFile,
	createConversationFileParseAccumulator,
	createDocumentEntryReference,
	documentFromFile,
	encodeConversationSessionId,
	initialConversationDocument,
	type ParsedConversationFile,
	serializeConversationLine,
	validateConversationEvent,
} from "./conversation-file-codec.js";
import { acquireConversationFileLock } from "./conversation-file-lock.js";
import { publishConversationFileExclusive } from "./conversation-file-publisher.js";
import { nodeErrorCode } from "./node-error-code.js";

/**
 * 缓存的源文件字节上限。长会话（数十 MB）每解析一次就要秒级，
 * 但也不能无上限驻留，因此超出后按访问顺序淘汰。
 */
const MAX_CACHED_CONVERSATION_BYTES = 64 * 1024 * 1024;

export interface FileConversationRepositoryOptions {
	readonly rootDir: string;
}

interface CachedConversationFile {
	readonly ino: number;
	readonly mtimeMs: number;
	/** 已解析到的文件字节偏移；总是落在完整记录边界上。 */
	readonly offset: number;
	readonly accumulator: ConversationFileParseAccumulator;
	file: ParsedConversationFile;
	document: ConversationDocument | undefined;
	/** document 已折叠到的 records 数量。 */
	documentRecords: number;
	conversation: StoredConversation | undefined;
	conversationRecords: number;
}

export class FileConversationRepository
	implements ConversationRepository, ConversationDocumentStore, ConversationContinuationStore
{
	private readonly rootDir: string;
	private readonly queues = new Map<string, Promise<void>>();
	/**
	 * 会话文件只追加，但每次文档命令都要读全文。长会话下这份重复解析会吃满单核，
	 * 因此按会话缓存解析累加器与已折叠的文档，只处理新增字节。
	 */
	private readonly parsedFiles = new Map<string, CachedConversationFile>();
	private cachedBytes = 0;
	private closed = false;

	constructor(options: FileConversationRepositoryOptions) {
		this.rootDir = resolve(options.rootDir);
	}

	/** Stable absolute path used by a composition root as the session identity path. */
	resolveConversationPath(sessionId: string): string {
		return this.conversationPath(sessionId);
	}

	/** Stable absolute directory containing this repository's session artifacts. */
	resolveSessionDirectory(): string {
		return this.rootDir;
	}

	async create(input: CreateConversationInput): Promise<ConversationMetadata> {
		this.assertOpen();
		return this.exclusive(input.sessionId, async () => {
			await this.ensureRoot();
			const header: ConversationFileHeader = {
				recordType: "conversation.header",
				schemaVersion: CONVERSATION_SCHEMA_VERSION,
				sessionId: input.sessionId,
				createdAt: input.createdAt,
				...(input.agentId ? { agentId: input.agentId } : {}),
				...(input.cwd ? { cwd: input.cwd } : {}),
			};
			const path = this.conversationPath(input.sessionId);
			try {
				await publishConversationFileExclusive(path, serializeConversationLine(header));
			} catch (error) {
				if (nodeErrorCode(error) === "EEXIST") {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
						`Conversation already exists: ${input.sessionId}`,
						{ cause: error },
					);
				}
				throw error;
			}
			return {
				sessionId: input.sessionId,
				createdAt: input.createdAt,
				version: 0,
			};
		});
	}

	async load(sessionId: string): Promise<StoredConversation> {
		this.assertOpen();
		return this.exclusive(sessionId, () => this.withFileLock(sessionId, () => this.readConversation(sessionId)));
	}

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		this.assertOpen();
		return this.exclusive(sessionId, () =>
			this.withFileLock(sessionId, async () => {
				const file = await this.readConversationFile(sessionId);
				return this.documentFor(sessionId, file);
			}),
		);
	}

	async execute(
		sessionId: string,
		expectedRevision: number | null,
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult> {
		this.assertOpen();
		if (!isConversationDocumentCommand(command)) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
				`Command for ${sessionId} does not match the conversation document command schema`,
			);
		}
		if (
			expectedRevision === null &&
			command.type !== "session.name.set" &&
			command.type !== "custom.append" &&
			command.type !== "entry.label.set"
		) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
				`Command ${command.type} requires an expected conversation document revision`,
			);
		}
		return this.exclusive(sessionId, () =>
			this.withFileLock(sessionId, async () => {
				const file = await this.readConversationFile(sessionId);
				if (file.header.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.READ_ONLY,
						`Conversation ${sessionId} uses read-only schema version ${file.header.schemaVersion}`,
					);
				}
				const document = this.documentFor(sessionId, file);
				if (expectedRevision !== null && document.revision !== expectedRevision) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.DOCUMENT_VERSION_CONFLICT,
						`Conversation document ${sessionId} is at revision ${document.revision}, expected ${expectedRevision}`,
					);
				}
				const result = applyConversationDocumentCommand(document, command);
				if (!result.changed) return result;
				const record: ConversationDocumentOperationRecord = {
					recordType: "conversation.document.operation",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					revision: result.document.revision,
					command,
				};
				await appendFile(this.conversationPath(sessionId), serializeConversationLine(record), "utf8");
				return result;
			}),
		);
	}

	async fork(sessionId: string, entryId: string): Promise<ConversationDocumentForkResult> {
		this.assertOpen();
		return this.exclusive(sessionId, () =>
			this.withFileLock(sessionId, async () => {
				const file = await this.readConversationFile(sessionId);
				if (file.header.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.READ_ONLY,
						`Conversation ${sessionId} uses read-only schema version ${file.header.schemaVersion}`,
					);
				}
				return this.writeFork(sessionId, entryId, file);
			}),
		);
	}

	async continueConversation(input: ContinueConversationInput): Promise<ConversationContinuationResult> {
		this.assertOpen();
		return this.exclusive(input.sourceSessionId, () =>
			this.withFileLock(input.sourceSessionId, async () => {
				const sourceFile = await this.readConversationFile(input.sourceSessionId);
				if (sourceFile.header.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.READ_ONLY,
						`Conversation ${input.sourceSessionId} uses read-only schema version ${sourceFile.header.schemaVersion}`,
					);
				}
				// 先取得增量投影的文档，再一次性投影会话：否则 conversationFromFile 会自己再折叠一遍全量记录。
				const sourceDocument = this.documentFor(input.sourceSessionId, sourceFile);
				const sourceConversation = conversationFromFile(input.sourceSessionId, sourceFile, sourceDocument);
				if (sourceConversation.version !== input.expectedVersion) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
						`Conversation ${input.sourceSessionId} is at version ${sourceConversation.version}, expected ${input.expectedVersion}`,
					);
				}
				const recoveryPlan = new FailInterruptedTurnRecoveryPolicy().plan(sourceConversation);
				if (recoveryPlan.status !== "interrupt" || recoveryPlan.turnId !== input.turnId) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
						`Conversation ${sourceConversation.sessionId} cannot continue inactive turn ${input.turnId}`,
					);
				}
				const carried = buildContinuationEntries(sourceDocument);
				if (!carried) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
						`Conversation ${input.sourceSessionId} has no compaction boundary to continue from`,
					);
				}

				const sessionId = randomUUID();
				const sourceSessionPath = this.conversationPath(input.sourceSessionId);
				const sessionPath = this.conversationPath(sessionId);
				const header: ConversationFileHeader = {
					recordType: "conversation.header",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					sessionId,
					createdAt: input.timestamp,
					agentId: sourceFile.header.agentId,
					cwd: sourceFile.header.cwd,
					parentSessionPath: sourceSessionPath,
					parentEntryId: carried.sourceEntryId,
				};
				const seedCandidate: unknown = {
					recordType: "conversation.continuation.seed",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					sourceSessionId: input.sourceSessionId,
					sourceSessionPath,
					sourceEntryId: carried.sourceEntryId,
					reason: input.reason,
					entries: carried.entries,
					activeLeafId: carried.activeLeafId,
				};
				if (!isConversationContinuationSeedRecord(seedCandidate)) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
						`Conversation ${input.sourceSessionId} produced an invalid continuation seed`,
					);
				}
				const seed: ConversationContinuationSeedRecord = seedCandidate;
				const continuedEvent = {
					type: "turn.continued",
					sessionId,
					turnId: input.turnId,
					sourceSessionId: input.sourceSessionId,
					snapshotId: input.snapshotId,
					reason: input.reason,
					timestamp: input.timestamp,
				} as const;
				const continuedRecord = {
					recordType: "conversation.event",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					sequence: 1,
					event: continuedEvent,
					documentEntry: null,
				} satisfies ConversationEventRecord;
				const transferredEvent = {
					type: "turn.transferred",
					sessionId: input.sourceSessionId,
					turnId: input.turnId,
					targetSessionId: sessionId,
					reason: input.reason,
					timestamp: input.timestamp,
				} as const;
				const transferredRecord = {
					recordType: "conversation.event",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					sequence: input.expectedVersion + 1,
					event: transferredEvent,
					documentEntry: null,
				} satisfies ConversationEventRecord;
				validateConversationEvent(sessionId, continuedEvent);
				validateConversationEvent(input.sourceSessionId, transferredEvent);

				const seedDocument = createSeededConversationDocument(
					{
						sessionId,
						createdAt: input.timestamp,
						agentId: header.agentId,
						cwd: header.cwd,
						parentSessionPath: sourceSessionPath,
						parentEntryId: carried.sourceEntryId,
					},
					carried.entries,
					carried.activeLeafId,
				);
				const seedConversation: StoredConversation = {
					sessionId,
					createdAt: input.timestamp,
					version: 0,
					messages: selectConversationDocumentModelMessages(seedDocument),
					events: [],
				};

				await this.ensureRoot();
				let targetPublished = false;
				try {
					await publishConversationFileExclusive(
						sessionPath,
						[
							serializeConversationLine(header),
							serializeConversationLine(seed),
							serializeConversationLine(continuedRecord),
						].join(""),
					);
					targetPublished = true;
					await appendFile(sourceSessionPath, serializeConversationLine(transferredRecord), "utf8");
				} catch (error) {
					if (targetPublished) await rm(sessionPath, { force: true });
					throw error;
				}

				return {
					sourceSessionId: input.sourceSessionId,
					sourceSessionPath,
					sourceVersion: input.expectedVersion + 1,
					sessionId,
					sessionDirectory: this.rootDir,
					sessionPath,
					version: 1,
					seedConversation,
					seedDocument,
					transferredEvent,
					continuedEvent,
				};
			}),
		);
	}

	async append(
		sessionId: string,
		expectedVersion: number,
		events: readonly StoredSessionEvent[],
	): Promise<AppendResult> {
		this.assertOpen();
		return this.exclusive(sessionId, () =>
			this.withFileLock(sessionId, async () => {
				const file = await this.readConversationFile(sessionId);
				// 会话版本就是事件条数；为了拿它投影一整份 conversation（含消息数组）会在每次落盘时白跑一遍全量折叠。
				const version = file.eventRecords.length;
				if (version !== expectedVersion) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
						`Conversation ${sessionId} is at version ${version}, expected ${expectedVersion}`,
					);
				}
				for (const event of events) validateConversationEvent(sessionId, event);
				if (events.length === 0) return { version: expectedVersion };

				let document = this.documentFor(sessionId, file);
				const records = events.map((event, index) => {
					const sequence = expectedVersion + index + 1;
					if (file.header.schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
						return {
							recordType: "conversation.event" as const,
							schemaVersion: file.header.schemaVersion,
							sequence,
							event,
						};
					}
					const documentEntry = createDocumentEntryReference(event, sequence, document.activeLeafId);
					const record = {
						recordType: "conversation.event" as const,
						schemaVersion: CONVERSATION_SCHEMA_VERSION,
						sequence,
						event,
						documentEntry,
					} satisfies ConversationEventRecord;
					document = applyStoredEventToConversationDocument(document, event, sequence, documentEntry ?? undefined);
					return record;
				});
				await appendFile(this.conversationPath(sessionId), records.map(serializeConversationLine).join(""), "utf8");
				return {
					version: expectedVersion + events.length,
				};
			}),
		);
	}

	async saveSnapshot(sessionId: string, snapshot: ConversationSnapshot): Promise<void> {
		this.assertOpen();
		await this.exclusive(sessionId, () =>
			this.withFileLock(sessionId, async () => {
				if (!isConversationSnapshot(snapshot)) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT,
						`Snapshot for ${sessionId} does not match the conversation snapshot schema`,
					);
				}
				if (snapshot.sessionId !== sessionId) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT,
						`Snapshot session ${snapshot.sessionId} does not match ${sessionId}`,
					);
				}
				const conversation = await this.readConversation(sessionId);
				if (snapshot.version !== conversation.version) {
					throw new ConversationStorageError(
						CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
						`Snapshot version ${snapshot.version} does not match conversation version ${conversation.version}`,
					);
				}
				await this.ensureRoot();
				const record: ConversationSnapshotRecord = {
					recordType: "conversation.snapshot",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					snapshot,
				};
				const target = this.snapshotPath(sessionId);
				const temporary = `${target}.${randomUUID()}.tmp`;
				try {
					await writeFile(temporary, `${JSON.stringify(record)}\n`, {
						encoding: "utf8",
						flag: "wx",
					});
					await rename(temporary, target);
				} catch (error) {
					await rm(temporary, { force: true });
					throw error;
				}
			}),
		);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await Promise.all(this.queues.values());
		this.parsedFiles.clear();
		this.cachedBytes = 0;
	}

	private async readConversation(sessionId: string): Promise<StoredConversation> {
		const file = await this.readConversationFile(sessionId);
		const cached = this.parsedFiles.get(sessionId);
		if (cached && cached.file === file && cached.conversation && cached.conversationRecords === file.records.length) {
			return cached.conversation;
		}
		const conversation = conversationFromFile(sessionId, file, this.documentFor(sessionId, file));
		if (cached && cached.file === file) {
			cached.conversation = conversation;
			cached.conversationRecords = file.records.length;
		}
		return conversation;
	}

	/**
	 * 缓存按源文件字节数封顶，超出后按访问顺序淘汰，避免长会话把内存吃光。
	 */
	private rememberParsedFile(sessionId: string, entry: CachedConversationFile): void {
		const previous = this.parsedFiles.get(sessionId);
		if (previous) this.cachedBytes -= previous.offset;
		this.parsedFiles.delete(sessionId);
		this.parsedFiles.set(sessionId, entry);
		this.cachedBytes += entry.offset;
		while (this.parsedFiles.size > 1 && this.cachedBytes > MAX_CACHED_CONVERSATION_BYTES) {
			const oldest = this.parsedFiles.keys().next();
			if (oldest.done) break;
			this.forgetParsedFile(oldest.value);
		}
	}

	private forgetParsedFile(sessionId: string): void {
		const entry = this.parsedFiles.get(sessionId);
		if (!entry) return;
		this.parsedFiles.delete(sessionId);
		this.cachedBytes -= entry.offset;
	}

	/**
	 * 按会话缓存解析结果，只读取上次偏移之后的新增字节。
	 *
	 * 会话文件是只追加的：同 inode 且长度只增、mtime 未变时可直接复用；
	 * 长度增长时只解析新增的完整行；长度回退或 inode 变化（重写/迁移）时重新全量解析。
	 */
	private async readConversationFile(sessionId: string): Promise<ParsedConversationFile> {
		let handle: FileHandle;
		try {
			handle = await open(this.conversationPath(sessionId), "r");
		} catch (error) {
			if (nodeErrorCode(error) === "ENOENT") {
				this.forgetParsedFile(sessionId);
				throw new ConversationStorageError(
					CONVERSATION_STORAGE_ERROR_CODES.NOT_FOUND,
					`Conversation not found: ${sessionId}`,
					{ cause: error },
				);
			}
			throw error;
		}

		try {
			const stats = await handle.stat();
			const cached = this.parsedFiles.get(sessionId);
			// 只在文件确实增长时才复用累加器：同尺寸但 mtime 变了意味着内容被原地重写。
			const appendOnly =
				cached !== undefined &&
				cached.ino === stats.ino &&
				stats.size >= cached.offset &&
				(stats.size > cached.offset || stats.mtimeMs === cached.mtimeMs);
			if (appendOnly && stats.size === cached.offset) {
				this.rememberParsedFile(sessionId, cached);
				return cached.file;
			}
			const accumulator = appendOnly ? cached.accumulator : createConversationFileParseAccumulator();
			const offset = appendOnly ? cached.offset : 0;
			try {
				const nextOffset = await this.consumeConversationBytes(handle, accumulator, offset, stats.size, sessionId);
				const file = conversationFileFromAccumulator(accumulator, sessionId);
				this.rememberParsedFile(sessionId, {
					ino: stats.ino,
					mtimeMs: stats.mtimeMs,
					offset: nextOffset,
					accumulator,
					file,
					document: appendOnly ? cached.document : undefined,
					documentRecords: appendOnly ? cached.documentRecords : 0,
					conversation: appendOnly ? cached.conversation : undefined,
					conversationRecords: appendOnly ? cached.conversationRecords : -1,
				});
				return file;
			} catch (error) {
				// 累加器可能已在失败前部分推进，不能留下半成品给下一次读取。
				this.forgetParsedFile(sessionId);
				throw error;
			}
		} finally {
			await handle.close();
		}
	}

	/**
	 * 逐块读取新增字节并追加到累加器；每块都落在记录边界上，不完整尾行交由解析器报错。
	 */
	private async consumeConversationBytes(
		handle: FileHandle,
		accumulator: ConversationFileParseAccumulator,
		offset: number,
		size: number,
		sessionId: string,
	): Promise<number> {
		if (size <= offset) return offset;
		const buffer = Buffer.allocUnsafe(size - offset);
		let filled = 0;
		while (filled < buffer.length) {
			const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, offset + filled);
			if (bytesRead === 0) break;
			filled += bytesRead;
		}
		if (filled === 0) return offset;
		const chunk = buffer.subarray(0, filled).toString("utf8");
		// 读取区间总是从记录边界开始；尾部不完整时由解析器报既有错误，不静默截断。
		appendConversationFileText(accumulator, chunk, sessionId);
		// 偏移按实际读到的字节推进：重编码后的字节数在尾部多字节字符被截断时会多算 1–2 字节，
		// 下次就会从记录中间开始解析，把截断伪装成文件损坏。
		return offset + filled;
	}

	/**
	 * 文档投影是记录上的纯折叠，只补算新增记录，避免每次读取都重放全量历史。
	 */
	private documentFor(sessionId: string, file: ParsedConversationFile): ConversationDocument {
		const cached = this.parsedFiles.get(sessionId);
		if (!cached || cached.file !== file) {
			// 缓存没有对应本次解析结果时退化为整份折叠。
			return documentFromFile(sessionId, file);
		}
		if (cached.document && cached.documentRecords === file.records.length) return cached.document;
		const base = cached.document ?? initialConversationDocument(sessionId, file);
		cached.document = applyConversationRecords(sessionId, base, file.records.slice(cached.documentRecords));
		cached.documentRecords = file.records.length;
		return cached.document;
	}

	private async writeFork(
		sessionId: string,
		entryId: string,
		file: ParsedConversationFile,
	): Promise<ConversationDocumentForkResult> {
		const document = this.documentFor(sessionId, file);
		const selectedEntry = conversationDocumentEntry(document, entryId);
		const text = extractConversationEntryText(selectedEntry);
		if (
			selectedEntry.type !== "message" ||
			!isObject(selectedEntry.message) ||
			selectedEntry.message.role !== "user"
		) {
			throw new Error("Invalid entry ID for forking");
		}
		const tipId = resolveConversationUserTurnTip(document, entryId);
		const branch = selectConversationDocumentEntries(document, tipId);
		const selectedEntryIds = new Set(branch.map((entry) => entry.id));
		const selectedTurnIds = new Set(
			file.eventRecords.flatMap((record) => {
				if (
					record.schemaVersion === CONVERSATION_SCHEMA_VERSION &&
					record.documentEntry &&
					selectedEntryIds.has(record.documentEntry.id)
				) {
					return [record.event.turnId];
				}
				return [];
			}),
		);
		const newSessionId = randomUUID();
		const newPath = this.conversationPath(newSessionId);
		const sourceSessionPath = this.conversationPath(sessionId);
		const header: ConversationFileHeader = {
			recordType: "conversation.header",
			schemaVersion: CONVERSATION_SCHEMA_VERSION,
			sessionId: newSessionId,
			createdAt: Date.now(),
			agentId: file.header.schemaVersion === CONVERSATION_SCHEMA_VERSION ? file.header.agentId : undefined,
			cwd: file.header.schemaVersion === CONVERSATION_SCHEMA_VERSION ? file.header.cwd : undefined,
			parentSessionPath: sourceSessionPath,
			parentEntryId: entryId,
		};
		const finalEntries = new Map(branch.map((entry) => [entry.id, entry]));
		const sourceSeed = file.seed ?? file.continuationSeed ?? file.importSeed;
		const sourceSeedEntryIds = new Set(sourceSeed?.entries.map((entry) => entry.id) ?? []);
		const seedEntries = rewriteForkSeedEntries(
			document,
			branch.filter((entry) => sourceSeedEntryIds.has(entry.id)),
		);
		const seedCandidate: unknown =
			seedEntries.length === 0
				? undefined
				: {
						recordType: "conversation.continuation.seed",
						schemaVersion: CONVERSATION_SCHEMA_VERSION,
						sourceSessionId: sessionId,
						sourceSessionPath,
						sourceEntryId: entryId,
						reason: "fork",
						entries: seedEntries,
						activeLeafId: seedEntries.at(-1)?.id ?? null,
					};
		if (seedCandidate !== undefined && !isConversationContinuationSeedRecord(seedCandidate)) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
				`Conversation ${sessionId} produced an invalid fork seed`,
			);
		}
		const seed: ConversationContinuationSeedRecord | undefined = seedCandidate;
		const records: Array<ConversationEventRecord | ConversationDocumentOperationRecord> = [];
		const targetIdentity = {
			sessionId: newSessionId,
			createdAt: header.createdAt,
			agentId: header.agentId,
			cwd: header.cwd,
			parentSessionPath: header.parentSessionPath,
			parentEntryId: header.parentEntryId,
		};
		let targetDocument = seed
			? createSeededConversationDocument(targetIdentity, seed.entries, seed.activeLeafId)
			: createEmptyConversationDocument(targetIdentity);
		let eventSequence = 0;
		for (const source of file.records) {
			if (source.recordType === "conversation.document.operation") {
				if (source.command.type !== "custom.append" || !selectedEntryIds.has(source.command.entryId)) {
					continue;
				}
				const entry = finalEntries.get(source.command.entryId);
				if (!entry || entry.type !== "custom") continue;
				if (targetDocument.activeLeafId !== entry.parentId) {
					const selected = applyConversationDocumentCommand(targetDocument, {
						type: "active_leaf.set",
						entryId: entry.parentId,
					});
					if (selected.changed) {
						records.push({
							recordType: "conversation.document.operation",
							schemaVersion: CONVERSATION_SCHEMA_VERSION,
							revision: selected.document.revision,
							command: { type: "active_leaf.set", entryId: entry.parentId },
						});
						targetDocument = selected.document;
					}
				}
				const command = {
					type: "custom.append" as const,
					entryId: entry.id,
					customType: entry.customType,
					data: entry.data,
					timestamp: entry.timestamp,
				};
				const result = applyConversationDocumentCommand(targetDocument, command);
				records.push({
					recordType: "conversation.document.operation",
					schemaVersion: CONVERSATION_SCHEMA_VERSION,
					revision: result.document.revision,
					command,
				});
				targetDocument = result.document;
				continue;
			}
			if (!selectedTurnIds.has(source.event.turnId)) continue;
			const sourceReference = source.schemaVersion === CONVERSATION_SCHEMA_VERSION ? source.documentEntry : null;
			if (source.event.type === "message.appended" && !sourceReference) continue;
			if (sourceReference && !selectedEntryIds.has(sourceReference.id)) continue;
			const entry = sourceReference ? finalEntries.get(sourceReference.id) : undefined;
			eventSequence += 1;
			const record = {
				recordType: "conversation.event",
				schemaVersion: CONVERSATION_SCHEMA_VERSION,
				sequence: eventSequence,
				event: { ...source.event, sessionId: newSessionId },
				documentEntry: entry ? { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp } : null,
			} satisfies ConversationEventRecord;
			records.push(record);
			targetDocument = applyStoredEventToConversationDocument(
				targetDocument,
				record.event,
				record.sequence,
				record.documentEntry ?? undefined,
			);
		}
		await this.ensureRoot();
		await publishConversationFileExclusive(
			newPath,
			[
				serializeConversationLine(header),
				...(seed ? [serializeConversationLine(seed)] : []),
				...records.map(serializeConversationLine),
			].join(""),
		);
		return { sessionId: newSessionId, path: newPath, text };
	}

	private async withFileLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		await this.ensureRoot();
		const release = await acquireConversationFileLock(this.lockPath(sessionId), sessionId);
		try {
			return await operation();
		} finally {
			await release();
		}
	}

	private async ensureRoot(): Promise<void> {
		await mkdir(this.rootDir, { recursive: true });
	}

	private conversationPath(sessionId: string): string {
		return join(this.rootDir, `${encodeConversationSessionId(sessionId)}.conversation.jsonl`);
	}

	private snapshotPath(sessionId: string): string {
		return join(this.rootDir, `${encodeConversationSessionId(sessionId)}.snapshot.json`);
	}

	private lockPath(sessionId: string): string {
		return `${this.conversationPath(sessionId)}.lock`;
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.CLOSED,
				"Conversation repository is closed",
			);
		}
	}

	private async exclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(sessionId) ?? Promise.resolve();
		let release = () => {};
		const gate = new Promise<void>((resolveGate) => {
			release = resolveGate;
		});
		const queued = previous.then(() => gate);
		this.queues.set(sessionId, queued);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.queues.get(sessionId) === queued) {
				this.queues.delete(sessionId);
			}
		}
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function rewriteForkSeedEntries(
	document: ConversationDocument,
	entries: readonly ConversationDocumentEntry[],
): readonly ConversationDocumentEntry[] {
	const selectedIds = new Set(entries.map((entry) => entry.id));
	const sourceById = new Map(document.entries.map((entry) => [entry.id, entry]));
	const resolveSelectedAncestor = (entryId: string): string | undefined => {
		let currentId: string | undefined = entryId;
		const visited = new Set<string>();
		while (currentId && !visited.has(currentId)) {
			if (selectedIds.has(currentId)) return currentId;
			visited.add(currentId);
			currentId = sourceById.get(currentId)?.parentId ?? undefined;
		}
		return undefined;
	};
	return entries.map((entry): ConversationDocumentEntry => {
		if (entry.type === "branch_summary" && entry.fromId !== "root" && !selectedIds.has(entry.fromId)) {
			return { ...entry, fromId: resolveSelectedAncestor(entry.fromId) ?? "root" };
		}
		if (entry.type === "compaction" && !selectedIds.has(entry.firstKeptEntryId)) {
			return { ...entry, firstKeptEntryId: resolveSelectedAncestor(entry.firstKeptEntryId) ?? entry.id };
		}
		if (entry.type === "label" && !selectedIds.has(entry.targetId)) {
			return {
				...entry,
				targetId: resolveSelectedAncestor(entry.targetId) ?? entry.parentId ?? entry.id,
			};
		}
		return entry;
	});
}

function buildContinuationEntries(document: ConversationDocument): {
	readonly sourceEntryId: string;
	readonly entries: readonly ConversationDocumentEntry[];
	readonly activeLeafId: string | null;
} | null {
	const branch = selectConversationDocumentEntries(document);
	let compactionIndex = -1;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "compaction" && entry.summaryMessage) {
			compactionIndex = index;
			break;
		}
	}
	if (compactionIndex < 0) return null;
	const compaction = branch[compactionIndex];
	if (!compaction || compaction.type !== "compaction") return null;
	const firstKeptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	if (firstKeptIndex < 0 || firstKeptIndex >= compactionIndex) {
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
			`Conversation ${document.identity.sessionId} has an invalid compaction kept tail`,
		);
	}
	const carried = [compaction, ...branch.slice(firstKeptIndex, compactionIndex), ...branch.slice(compactionIndex + 1)];
	const targetIds = new Map(carried.map((entry, index) => [entry.id, `seed-${index + 1}`]));
	const entries: ConversationDocumentEntry[] = [];
	let parentId: string | null = null;
	for (const source of carried) {
		const id = targetIds.get(source.id);
		if (!id) throw new Error(`Continuation entry ID was not allocated for ${source.id}`);
		const entry = rewriteContinuationEntry(source, id, parentId, targetIds);
		entries.push(entry);
		parentId = id;
	}
	const first = entries[0];
	if (!first || first.type !== "compaction") {
		throw new Error("Continuation seed must start with a compaction entry");
	}
	const firstKeptEntryId = entries[1]?.id ?? first.id;
	entries[0] = { ...first, firstKeptEntryId };
	return {
		sourceEntryId: compaction.id,
		entries,
		activeLeafId: entries.at(-1)?.id ?? null,
	};
}

function rewriteContinuationEntry(
	entry: ConversationDocumentEntry,
	id: string,
	parentId: string | null,
	targetIds: ReadonlyMap<string, string>,
): ConversationDocumentEntry {
	switch (entry.type) {
		case "compaction":
			return { ...entry, id, parentId };
		case "branch_summary":
			return { ...entry, id, parentId, fromId: targetIds.get(entry.fromId) ?? entry.fromId };
		case "label":
			return { ...entry, id, parentId, targetId: targetIds.get(entry.targetId) ?? entry.targetId };
		case "tool_timing":
			return { ...entry, id, parentId, phases: [...entry.phases] };
		default:
			return { ...entry, id, parentId };
	}
}
