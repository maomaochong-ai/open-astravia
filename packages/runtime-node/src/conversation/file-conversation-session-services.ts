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
import { resolveSessionIdFromPath } from "./conversation-file-path.js";
import { FileConversationOwnershipManager } from "./conversation-ownership-lease.js";
import { FileConversationRepository } from "./file-conversation-repository.js";
import { nodeErrorCode } from "./node-error-code.js";

const CONVERSATION_FILE_SUFFIX = ".conversation.jsonl";
/** 与 renderer 的 NO_MESSAGES_SENTINEL 同值：那里靠它判定“还没取到可用标题”。 */
const NO_MESSAGES_PLACEHOLDER = "(no messages)";
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
interface CachedSessionHeader {
	readonly size: number;
	readonly mtimeMs: number;
	readonly sessionId: string;
}
/**
 * 归属判定只需要知道「这个文件是谁的」，不必再读一遍内容；而 access 解析会对列表里每条会话各问一次。
 * 列表这一趟已经读过文件头，这里记住 (size, mtime) → sessionId，命中时只花一次 stat。
 */
const sessionHeaderCache = new Map<string, CachedSessionHeader>();

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

	/**
	 * 归属口径必须和「会不会把这个文件列出来」一致。
	 *
	 * 文件头读不出来时，列表靠文件名还原 id 继续显示（见 {@link recoverDamagedSessionHistoryInfo}），
	 * 删除也靠文件名兜底（见 {@link resolveDeletableSessionId}）。如果这里只认完整可读的文件，
	 * 这类残档就会被 access 解析判成「无人认领」——宿主回填全 false，侧栏里既打不开也删不掉，
	 * 只能永远占着一行「未命名会话」。
	 */
	async ownsSession(sessionPath: string): Promise<boolean> {
		return (await resolveOwnedSessionId(sessionPath)) !== undefined;
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
		const sessionId = await resolveDeletableSessionId(path);
		const lease = await this.ownershipManager.acquire(path);
		let releaseFileLock: (() => Promise<void>) | undefined;
		try {
			releaseFileLock = await acquireConversationFileLock(`${path}.lock`, sessionId);
			await this.artifactCleaner?.deleteSessionArtifacts(sessionId);
			await rm(join(dirname(path), `${encodeConversationSessionId(sessionId)}.snapshot.json`), {
				force: true,
			});
			// 未发送输入队列是独立 sidecar，主文件删掉后它会永久留在目录里；下一次恢复
			// 也可能把它当成某个新会话的待发队列。
			await rm(`${path}.queue.json`, { force: true });
			await rm(path, { force: true });
			forgetSessionCaches(path);
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
						const cached = sessionInfoCache.get(sessionInfoCacheKey(resolve(sessionPath), cwd))?.info;
						if (cached) return cached;
						// 冷启动时还没有缓存：退到“只读文件头”的降级结果，而不是把会话藏起来。
						// 侧栏宁可少一条预览，也不能让用户以为会话被删了。
						return readDegradedSessionHistoryInfo(sessionPath, cwd);
					}
				}),
		);
		return sessions.filter((session): session is SessionHistoryInfo => session !== undefined);
	}
}

/** Native conversation 文件到 Runtime 历史合同的只读投影。 */
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
		return projectFile(sessionPath, readFileSync(sessionPath, "utf8"));
	}

	async readAsync(sessionPath: string): Promise<{ history: HistoryEntry[] }> {
		// 解析与投影是纯计算，留在调用线程；这里只把「整份文件同步读」从事件循环里拿出去。
		// 壳层打开会话时先用这份历史出首屏，几 MB 的同步读会把所有窗口的 IPC 一起卡住。
		return projectFile(sessionPath, await readFile(sessionPath, "utf8"));
	}
}

/** 同步与异步两条入口共用同一套标题、格式与分支投影，避免两条路各写一遍。 */
function projectFile(sessionPath: string, text: string): { history: HistoryEntry[] } {
	const header = parseConversationHeader(text);
	if (!header || !isCanonicalConversationPath(sessionPath, header.sessionId)) {
		throw new Error(`Unsupported native conversation file: ${sessionPath}`);
	}
	const file = parseConversationFile(text, header.sessionId);
	return { history: projectConversationDocumentHistory(documentFromFile(header.sessionId, file)) };
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
	rememberSessionHeader(resolve(info.path), stats, info.id);
}

function rememberSessionHeader(path: string, stats: { size: number; mtimeMs: number }, sessionId: string): void {
	if (!sessionHeaderCache.has(path) && sessionHeaderCache.size >= SESSION_INFO_CACHE_LIMIT) {
		const oldest = sessionHeaderCache.keys().next();
		if (!oldest.done) sessionHeaderCache.delete(oldest.value);
	}
	sessionHeaderCache.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, sessionId });
}

/** 文件没了，两份缓存都得跟着掉：否则已删掉的会话会被旧结果重新拉回列表或继续被认领。 */
function forgetSessionCaches(path: string): void {
	for (const key of sessionInfoCache.keys()) {
		if (key.slice(0, path.length) === path && key.charAt(path.length) === "\n") sessionInfoCache.delete(key);
	}
	sessionHeaderCache.delete(path);
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
		if (nodeErrorCode(error) === "ENOENT") forgetSessionCaches(path);
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
	const document = documentFromFile(
		header.sessionId,
		parseConversationFile(dropIncompleteTail(text), header.sessionId),
	);
	const history = projectConversationDocumentHistory(document);
	const conversationMessages = history.flatMap((entry) => {
		if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
			return [];
		}
		return [entry.message];
	});
	// 列表只需要首条用户消息与最后一条消息。旧实现在这里把**每条**消息都抽一遍文本，
	// 上千轮的会话就是上千次 normalize；展开项目、启动首屏都在这个路径上。
	const firstMessage = findFirstUserMessageText(conversationMessages) ?? NO_MESSAGES_PLACEHOLDER;
	const lastMessagePreview = findLastMessageText(conversationMessages)?.slice(0, LAST_MESSAGE_PREVIEW_LENGTH);
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

/**
 * 真读不出完整内容时的降级结果：只靠文件头 + mtime 让会话留在列表里。
 *
 * 侧栏里一条带旧标题的会话，和一条彻底消失的会话，对用户的含义完全不同——后者看起来
 * 就是数据丢了。所以宁可只给文件名和时间，也不返回 undefined。
 */
async function readDegradedSessionHistoryInfo(
	sessionPath: string,
	fallbackCwd: string,
): Promise<SessionHistoryInfo | undefined> {
	try {
		const header = await readConversationHeader(sessionPath);
		if (!header || !isCanonicalConversationPath(sessionPath, header.sessionId)) {
			return await recoverDamagedSessionHistoryInfo(sessionPath, fallbackCwd);
		}
		// v1 文件头只有 sessionId/createdAt：身份与父子关系只在 v2 头上才有。
		const agentId = "agentId" in header ? header.agentId : undefined;
		const cwd = "cwd" in header ? header.cwd : undefined;
		const parentSessionPath = "parentSessionPath" in header ? header.parentSessionPath : undefined;
		const parentEntryId = "parentEntryId" in header ? header.parentEntryId : undefined;
		const info: SessionHistoryInfo = {
			id: header.sessionId,
			path: resolve(sessionPath),
			...(agentId === undefined ? {} : { agentId }),
			cwd: cwd ?? fallbackCwd,
			firstMessage: NO_MESSAGES_PLACEHOLDER,
			modifiedAt: header.createdAt,
			...(parentSessionPath === undefined ? {} : { parentSessionPath }),
			...(parentEntryId === undefined ? {} : { parentEntryId }),
		};
		return info;
	} catch {
		return await recoverDamagedSessionHistoryInfo(sessionPath, fallbackCwd);
	}
}

/**
 * 文件头读不出来时的最后一级兜底。
 *
 * 会话文件被并发删除或迁移打断后，磁盘上可能只剩若干条没有文件头的记录。这里如果
 * 直接放弃，用户看到的就是「会话凭空消失」，而文件明明还在。目录名和文件名都是可逆
 * 编码，所以至少能把 id 与修改时间还原出来，让这个会话继续可见（打开时会明确报错，
 * 也仍然可以删除），而不是静默从侧栏里抹掉。
 */
async function recoverDamagedSessionHistoryInfo(
	sessionPath: string,
	fallbackCwd: string,
): Promise<SessionHistoryInfo | undefined> {
	const path = resolve(sessionPath);
	const sessionId = resolveSessionIdFromPath(dirname(path), path);
	if (!sessionId) return undefined;
	try {
		const stats = await stat(path);
		if (!stats.isFile()) return undefined;
		return {
			id: sessionId,
			path,
			cwd: fallbackCwd,
			firstMessage: NO_MESSAGES_PLACEHOLDER,
			modifiedAt: stats.mtimeMs,
		};
	} catch {
		return undefined;
	}
}

/**
 * 写手正在追写时，读到的最后一行可能只有半个 JSON。
 *
 * 丢掉这个未写完的尾巴，是“本趟读不出完整文件”与“文件真的坏了”之间的分界线。
 * 严格校验仍然是写入侧的规则（半行必须被抓到），列表这里只需要能看见会话。
 */
function dropIncompleteTail(text: string): string {
	if (text.length === 0 || text.endsWith("\n")) return text;
	const lastNewline = text.lastIndexOf("\n");
	return lastNewline === -1 ? text : text.slice(0, lastNewline + 1);
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

/** 列表预览只需要 role / content / timestamp 三件事，不关心消息的其余字段。 */
interface PreviewMessageShape {
	readonly role: string;
	readonly content: unknown;
	readonly timestamp: number;
}

/** 首条有文本的用户消息；遍历到即停，不做全量文本抽取。 */
function findFirstUserMessageText(messages: readonly PreviewMessageShape[]): string | undefined {
	for (const message of messages) {
		if (message.role !== "user") continue;
		const text = extractMessageText(message.content);
		if (text) return text;
	}
	return undefined;
}

/** 最后一条有文本的消息（不区分角色，与原实现的 `messageTexts.at(-1)` 一致）。 */
function findLastMessageText(messages: readonly PreviewMessageShape[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const text = extractMessageText(messages[index]?.content);
		if (text) return text;
	}
	return undefined;
}

/**
 * 与列表、删除共用的归属判定：文件头可读且路径与 sessionId 对应，或者文件还在、文件名本身能解出 id。
 *
 * 已经不在磁盘上的路径不算自己的——清理逻辑和 access 解析会据此跳过它，而不是对着不存在的文件报错。
 */
async function resolveOwnedSessionId(sessionPath: string): Promise<string | undefined> {
	const path = resolve(sessionPath);
	const stats = await stat(path).catch(() => undefined);
	if (!stats?.isFile()) return undefined;
	const cached = sessionHeaderCache.get(path);
	if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return cached.sessionId;
	let sessionId: string | undefined;
	try {
		const header = await readConversationHeader(path);
		if (header && isCanonicalConversationPath(path, header.sessionId)) sessionId = header.sessionId;
	} catch {
		// 读不出来（被并发替换、还没写完、没有权限）时只能靠文件名；文件是否存在上面已经判过。
	}
	sessionId ??= resolveSessionIdFromPath(dirname(path), path);
	if (sessionId) rememberSessionHeader(path, stats, sessionId);
	return sessionId;
}

/**
 * 解析待删除会话的 id。
 *
 * 正常会话用文件头；文件头已经读不出来的损坏会话退回文件名里的可逆编码——否则这个
 * 打不开的条目会永久占着侧栏，用户连删掉它都做不到。
 */
async function resolveDeletableSessionId(sessionPath: string): Promise<string> {
	const header = await readConversationHeader(sessionPath).catch((error: unknown) => {
		if (nodeErrorCode(error) === "ENOENT") throw error;
		return undefined;
	});
	if (header && isCanonicalConversationPath(sessionPath, header.sessionId)) return header.sessionId;
	const sessionId = resolveSessionIdFromPath(dirname(sessionPath), sessionPath);
	if (!sessionId) throw new Error(`Unsupported native conversation file: ${sessionPath}`);
	return sessionId;
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
