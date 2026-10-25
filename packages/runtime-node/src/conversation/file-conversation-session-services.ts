import { closeSync, type Dirent, openSync, readFileSync, readSync } from "node:fs";
import { type FileHandle, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
	HistoryEntry,
	ProjectInfo,
	RuntimeSessionCatalog,
	RuntimeSessionFileHistoryReader,
	SessionHistoryInfo,
} from "@astravia/runtime-core";
import { projectConversationDocumentHistory } from "@astravia/runtime-core/conversation";
import {
	type ConversationOwnershipManager,
	isConversationFileHeader,
	type ReadConversationFileHeader,
} from "@astravia/runtime-storage/conversation";
import { documentFromFile, encodeConversationSessionId, parseConversationFile } from "./conversation-file-codec.js";
import { acquireConversationFileLock } from "./conversation-file-lock.js";
import { FileConversationOwnershipManager } from "./conversation-ownership-lease.js";
import { FileConversationRepository } from "./file-conversation-repository.js";
import { nodeErrorCode } from "./node-error-code.js";

const CONVERSATION_FILE_SUFFIX = ".conversation.jsonl";
const CONVERSATION_HEADER_READ_BYTES = 64 * 1024;
const LAST_MESSAGE_PREVIEW_LENGTH = 120;

interface CachedSessionHistoryInfo {
	readonly size: number;
	readonly mtimeMs: number;
	readonly info: SessionHistoryInfo;
}
const SESSION_INFO_CACHE_LIMIT = 512;
/**
 * `SessionHistoryInfo` 只能靠「整份文件读入 + 全量投影」算出来，而列表在每个 Turn 边界都会重列一次。
 * 记住上一份结果，文件大小与 mtime 都没变时只 stat：多会话并发时不再反复解析几 MB 的会话。
 */
const sessionInfoCache = new Map<string, CachedSessionHistoryInfo>();

export interface RuntimeConversationSessionRoot {
	readonly cwd: string;
	readonly sessionDir: string;
}

export interface FileConversationRuntimeSessionCatalogOptions {
	readonly roots?: readonly RuntimeConversationSessionRoot[];
	readonly ownershipManager?: ConversationOwnershipManager;
	readonly artifactCleaner?: ConversationSessionArtifactCleaner;
}

export interface ConversationSessionArtifactCleaner {
	deleteSessionArtifacts(sessionId: string): Promise<void>;
}

/** Native conversation 文件的离线目录与生命周期适配器。 */
export class FileConversationRuntimeSessionCatalog implements RuntimeSessionCatalog {
	private readonly roots: readonly RuntimeConversationSessionRoot[];
	private readonly ownershipManager: ConversationOwnershipManager;
	private readonly artifactCleaner: ConversationSessionArtifactCleaner | undefined;

	constructor(options: FileConversationRuntimeSessionCatalogOptions = {}) {
		this.roots = options.roots ?? [];
		this.ownershipManager = options.ownershipManager ?? new FileConversationOwnershipManager();
		this.artifactCleaner = options.artifactCleaner;
	}

	async ownsSession(sessionPath: string): Promise<boolean> {
		try {
			const header = await readConversationHeader(sessionPath);
			return header !== undefined && isCanonicalConversationPath(sessionPath, header.sessionId);
		} catch {
			return false;
		}
	}

	async listProjects(): Promise<ProjectInfo[]> {
		const sessionsByCwd = new Map<string, Set<string>>();
		for (const root of this.roots) {
			const sessions = await this.listRoot(root.cwd, root.sessionDir);
			let paths = sessionsByCwd.get(root.cwd);
			if (!paths) {
				paths = new Set<string>();
				sessionsByCwd.set(root.cwd, paths);
			}
			for (const session of sessions) paths.add(resolve(session.path));
		}
		return Array.from(sessionsByCwd, ([cwd, paths]) => ({ cwd, sessionCount: paths.size }))
			.filter(({ sessionCount }) => sessionCount > 0)
			.sort((left, right) => left.cwd.localeCompare(right.cwd));
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		const roots = sessionDir
			? [{ cwd, sessionDir }]
			: this.roots.filter((root) => resolve(root.cwd) === resolve(cwd));
		const lists = await Promise.all(roots.map((root) => this.listRoot(root.cwd, root.sessionDir)));
		const sessions = new Map<string, SessionHistoryInfo>();
		for (const list of lists) {
			for (const session of list) sessions.set(resolve(session.path), session);
		}
		return Array.from(sessions.values()).sort((left, right) => right.modifiedAt - left.modifiedAt);
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		const path = resolve(sessionPath);
		await requireConversationHeader(path);
		const lease = await this.ownershipManager.acquire(path);
		const repository = new FileConversationRepository({ rootDir: dirname(path) });
		try {
			const header = await requireConversationHeader(path);
			if (repository.resolveConversationPath(header.sessionId) !== path) {
				throw new Error(`Conversation path does not match its session id: ${path}`);
			}
			await repository.execute(header.sessionId, null, { type: "session.name.set", name });
		} finally {
			await repository.close();
			await lease.release();
		}
	}

	async deleteSessionArtifacts(sessionPath: string): Promise<void> {
		const path = resolve(sessionPath);
		await requireConversationHeader(path);
		const lease = await this.ownershipManager.acquire(path);
		let releaseFileLock: (() => Promise<void>) | undefined;
		try {
			const header = await requireConversationHeader(path);
			releaseFileLock = await acquireConversationFileLock(`${path}.lock`, header.sessionId);
			await this.artifactCleaner?.deleteSessionArtifacts(header.sessionId);
			await rm(join(dirname(path), `${encodeConversationSessionId(header.sessionId)}.snapshot.json`), {
				force: true,
			});
			await rm(path, { force: true });
		} finally {
			await releaseFileLock?.();
			await lease.release();
		}
	}

	private async listRoot(cwd: string, sessionDir: string): Promise<SessionHistoryInfo[]> {
		let entries: Dirent<string>[];
		try {
			entries = await readdir(sessionDir, { withFileTypes: true });
		} catch (error) {
			if (nodeErrorCode(error) === "ENOENT") return [];
			throw error;
		}
		const sessions = await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(CONVERSATION_FILE_SUFFIX))
				.map(async (entry) => {
					const sessionPath = join(sessionDir, entry.name);
					try {
						return await readListedSessionHistoryInfo(sessionPath, cwd);
					} catch (error) {
						// 文件真的没了才是删除了。其它失败（比如另一写入者正在替换/追写，这一趟读不出完整文件）
						// 只是暂时读不到：返回上一次的结果，否则会话会从侧栏凭空消失。
						if (nodeErrorCode(error) === "ENOENT") return undefined;
						return sessionInfoCache.get(sessionInfoCacheKey(resolve(sessionPath), cwd))?.info;
					}
				}),
		);
		return sessions.filter((session): session is SessionHistoryInfo => session !== undefined);
	}
}

/** Native conversation 文件到 Runtime 历史合同的同步只读投影。 */
export class FileConversationRuntimeSessionFileHistoryReader implements RuntimeSessionFileHistoryReader {
	canRead(sessionPath: string): boolean {
		try {
			const header = readConversationHeaderSync(sessionPath);
			return header !== undefined && isCanonicalConversationPath(sessionPath, header.sessionId);
		} catch {
			return false;
		}
	}

	read(sessionPath: string): { history: HistoryEntry[] } {
		const text = readFileSync(sessionPath, "utf8");
		const header = parseConversationHeader(text);
		if (!header || !isCanonicalConversationPath(sessionPath, header.sessionId)) {
			throw new Error(`Unsupported native conversation file: ${sessionPath}`);
		}
		const file = parseConversationFile(text, header.sessionId);
		return { history: projectConversationDocumentHistory(documentFromFile(header.sessionId, file)) };
	}
}

function sessionInfoCacheKey(sessionPath: string, fallbackCwd: string): string {
	// 文件头缺 cwd 时才用调用方的兜底值，所以同一个文件可能因为 root 不同需要两份结果。
	return `${sessionPath}\n${fallbackCwd}`;
}

function rememberSessionInfo(key: string, stats: { size: number; mtimeMs: number }, info: SessionHistoryInfo): void {
	if (!sessionInfoCache.has(key) && sessionInfoCache.size >= SESSION_INFO_CACHE_LIMIT) {
		const oldest = sessionInfoCache.keys().next();
		if (!oldest.done) sessionInfoCache.delete(oldest.value);
	}
	sessionInfoCache.set(key, { size: stats.size, mtimeMs: stats.mtimeMs, info });
}

async function readListedSessionHistoryInfo(sessionPath: string, fallbackCwd: string): Promise<SessionHistoryInfo> {
	const path = resolve(sessionPath);
	const key = sessionInfoCacheKey(path, fallbackCwd);
	const cached = sessionInfoCache.get(key);
	let stats: { size: number; mtimeMs: number };
	try {
		stats = await stat(path);
	} catch (error) {
		// 文件不在了：缓存也得跟着掉，否则已删掉的会话会被旧结果拉回列表。
		if (nodeErrorCode(error) === "ENOENT") sessionInfoCache.delete(key);
		throw error;
	}
	if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return cached.info;
	const info = await readSessionHistoryInfo(path, fallbackCwd);
	rememberSessionInfo(key, stats, info);
	return info;
}

async function readSessionHistoryInfo(sessionPath: string, fallbackCwd: string): Promise<SessionHistoryInfo> {
	const text = await readFile(sessionPath, "utf8");
	const header = parseConversationHeader(text);
	if (!header || !isCanonicalConversationPath(sessionPath, header.sessionId)) {
		throw new Error(`Unsupported native conversation file: ${sessionPath}`);
	}
	const document = documentFromFile(header.sessionId, parseConversationFile(text, header.sessionId));
	const history = projectConversationDocumentHistory(document);
	const conversationMessages = history.flatMap((entry) => {
		if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
			return [];
		}
		return [entry.message];
	});
	const messageTexts = conversationMessages.flatMap((message) => {
		const text = extractMessageText(message.content);
		return text ? [{ role: message.role, text }] : [];
	});
	const firstMessage = messageTexts.find(({ role }) => role === "user")?.text ?? "(no messages)";
	const lastMessagePreview = messageTexts.at(-1)?.text.slice(0, LAST_MESSAGE_PREVIEW_LENGTH);
	// File mtime is a storage implementation detail: importing/resuming an existing
	// conversation may rewrite or recover the JSONL without any new user activity.
	// Use the already validated history projection so previews, branches and activity
	// time share one source of truth instead of inspecting opaque document entries here.
	const lastMessageActivityAt = conversationMessages.reduce<number | undefined>((latest, message) => {
		if (!Number.isFinite(message.timestamp) || message.timestamp <= 0) return latest;
		return Math.max(latest ?? 0, message.timestamp);
	}, undefined);
	const modifiedAt = lastMessageActivityAt ?? (await stat(sessionPath)).mtimeMs;
	return {
		id: header.sessionId,
		path: resolve(sessionPath),
		agentId: document.identity.agentId,
		cwd: document.identity.cwd ?? fallbackCwd,
		name: document.name,
		firstMessage,
		modifiedAt,
		lastMessagePreview,
		parentSessionPath: document.identity.parentSessionPath,
		parentEntryId: document.identity.parentEntryId,
	};
}

function extractMessageText(content: unknown): string | undefined {
	if (typeof content === "string") return normalizeMessageText(content);
	if (!Array.isArray(content)) return undefined;
	const text = content
		.flatMap((part) =>
			typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
				? [part.text]
				: [],
		)
		.join("\n");
	return normalizeMessageText(text);
}

function normalizeMessageText(text: string): string | undefined {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized || undefined;
}

async function requireConversationHeader(sessionPath: string): Promise<ReadConversationFileHeader> {
	const header = await readConversationHeader(sessionPath);
	if (!header || !isCanonicalConversationPath(sessionPath, header.sessionId)) {
		throw new Error(`Unsupported native conversation file: ${sessionPath}`);
	}
	return header;
}

async function readConversationHeader(sessionPath: string): Promise<ReadConversationFileHeader | undefined> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(sessionPath, "r");
		const buffer = Buffer.alloc(CONVERSATION_HEADER_READ_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return parseConversationHeader(firstCompleteLine(buffer, bytesRead));
	} finally {
		await handle?.close();
	}
}

function readConversationHeaderSync(sessionPath: string): ReadConversationFileHeader | undefined {
	const descriptor = openSync(sessionPath, "r");
	try {
		const buffer = Buffer.alloc(CONVERSATION_HEADER_READ_BYTES);
		return parseConversationHeader(firstCompleteLine(buffer, readSync(descriptor, buffer, 0, buffer.length, 0)));
	} finally {
		closeSync(descriptor);
	}
}

function parseConversationHeader(text: string | undefined): ReadConversationFileHeader | undefined {
	const firstLine = text?.split(/\r?\n/, 1)[0];
	if (!firstLine) return undefined;
	try {
		const value: unknown = JSON.parse(firstLine);
		return isConversationFileHeader(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function firstCompleteLine(buffer: Buffer, bytesRead: number): string | undefined {
	const text = buffer.toString("utf8", 0, bytesRead);
	const newline = text.indexOf("\n");
	if (newline === -1 && bytesRead === buffer.length) return undefined;
	return (newline === -1 ? text : text.slice(0, newline)).replace(/\r$/, "") || undefined;
}

function isCanonicalConversationPath(sessionPath: string, sessionId: string): boolean {
	return (
		resolve(sessionPath) ===
		resolve(dirname(sessionPath), `${encodeConversationSessionId(sessionId)}${CONVERSATION_FILE_SUFFIX}`)
	);
}
