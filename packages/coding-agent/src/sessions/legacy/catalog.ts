import type { ProjectInfo, RuntimeSessionCatalog, SessionHistoryInfo } from "@astravia/runtime-core";
import type { CodingAgentSessionEntry } from "../contracts/session-entry.js";
import { parseCodingAgentLegacySessionDocument } from "./document.js";
import { isLegacySessionHeader } from "./header-reader.js";
import type { LegacySessionFileHost } from "./host-contracts.js";

interface CachedLegacySessionInfo {
	readonly fileModifiedAt: number;
	readonly info: SessionHistoryInfo;
}

const LEGACY_SESSION_INFO_CACHE_LIMIT = 512;
/**
 * `SessionHistoryInfo` 需把整份 JSONL 读入再全量投影；而旧格式会话往往累积到几 MB，
 * 项目列表与侧栏却在每次刷新时把目录里所有文件再算一遍。按 mtime 记住结果，
 * 文件没变时一次 stat 就结束，写一次只让那一个会话失效。
 */
const legacySessionInfoCache = new Map<string, CachedLegacySessionInfo>();

function rememberLegacySessionInfo(sessionPath: string, fileModifiedAt: number, info: SessionHistoryInfo): void {
	if (!legacySessionInfoCache.has(sessionPath) && legacySessionInfoCache.size >= LEGACY_SESSION_INFO_CACHE_LIMIT) {
		const oldest = legacySessionInfoCache.keys().next();
		if (!oldest.done) legacySessionInfoCache.delete(oldest.value);
	}
	legacySessionInfoCache.set(sessionPath, { fileModifiedAt, info });
}

/** 旧 Coding Agent JSONL 的发现、命名与删除适配；不创建 AgentSession。 */
export class LegacyRuntimeSessionCatalog implements RuntimeSessionCatalog {
	constructor(private readonly host: LegacySessionFileHost) {}

	async ownsSession(sessionPath: string): Promise<boolean> {
		try {
			return isLegacySessionHeader(await this.host.readFirstLine(sessionPath));
		} catch {
			return false;
		}
	}

	async listProjects(): Promise<ProjectInfo[]> {
		const sessions = await this.listAllLegacySessions();
		const byCwd = new Map<string, number>();
		for (const session of sessions) {
			const cwd = session.cwd || this.host.defaultCwd;
			byCwd.set(cwd, (byCwd.get(cwd) ?? 0) + 1);
		}
		return Array.from(byCwd, ([cwd, sessionCount]) => ({ cwd, sessionCount })).sort((left, right) =>
			left.cwd.localeCompare(right.cwd),
		);
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		return this.listLegacySessionsFromDirectory(sessionDir ?? this.resolveLegacySessionDirectory(cwd));
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		const leaseResult = this.host.acquireLease(sessionPath);
		if (leaseResult.kind === "locked") {
			throw new Error(
				`Session file is in use by another process (pid ${leaseResult.holder.pid}@${leaseResult.holder.hostname}). ` +
					`Lock file: ${leaseResult.lockPath}`,
			);
		}
		try {
			const document = parseCodingAgentLegacySessionDocument(this.host.readText(sessionPath));
			const ids = new Set(document.entries.map(({ id }) => id));
			await this.host.appendText(
				sessionPath,
				`${JSON.stringify({
					type: "session_info",
					id: this.createEntryId(ids),
					parentId: document.activeLeafId,
					timestamp: new Date().toISOString(),
					name: name.trim(),
				})}\n`,
			);
		} finally {
			leaseResult.lease.release();
		}
	}

	async deleteSessionArtifacts(sessionPath: string): Promise<void> {
		await this.host.remove(sessionPath);
		await this.host.remove(`${sessionPath}.lock`);
		// 文件已删：缓存也得跟着掉，否则下次列表还会把这条会话捧回来。
		legacySessionInfoCache.delete(sessionPath);
	}

	private resolveLegacySessionDirectory(cwd: string): string {
		const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
		return this.host.join(this.host.sessionsDirectory, safePath);
	}

	private async listAllLegacySessions(): Promise<SessionHistoryInfo[]> {
		if (!this.host.exists(this.host.sessionsDirectory)) return [];
		try {
			const entries = await this.host.readDirectory(this.host.sessionsDirectory);
			const lists = await Promise.all(
				entries
					.filter((entry) => entry.kind === "directory")
					.map((entry) =>
						this.listLegacySessionsFromDirectory(this.host.join(this.host.sessionsDirectory, entry.name)),
					),
			);
			return lists.flat().sort((left, right) => right.modifiedAt - left.modifiedAt);
		} catch {
			return [];
		}
	}

	private async listLegacySessionsFromDirectory(directory: string): Promise<SessionHistoryInfo[]> {
		if (!this.host.exists(directory)) return [];
		try {
			const entries = await this.host.readDirectory(directory);
			const sessions = await Promise.all(
				entries
					.filter((entry) => entry.kind === "file" && entry.name.endsWith(".jsonl"))
					.map((entry) => this.buildLegacySessionHistoryInfo(this.host.join(directory, entry.name))),
			);
			return sessions
				.filter((session): session is SessionHistoryInfo => session !== undefined)
				.sort((left, right) => right.modifiedAt - left.modifiedAt);
		} catch {
			return [];
		}
	}

	private async buildLegacySessionHistoryInfo(sessionPath: string): Promise<SessionHistoryInfo | undefined> {
		try {
			const fileModifiedAt = await this.host.statModifiedAt(sessionPath);
			const cached = legacySessionInfoCache.get(sessionPath);
			// 文件没变就不重建摘要：旧格式会话往往很大，而项目列表/侧栏每次刷新都会走到这里。
			if (cached && cached.fileModifiedAt === fileModifiedAt) return cached.info;
			if (!(await this.ownsSession(sessionPath))) return undefined;
			const document = parseCodingAgentLegacySessionDocument(this.host.readText(sessionPath));
			const messages = document.entries.flatMap((entry) => readConversationMessage(entry));
			const textMessages = messages.filter(({ text }) => text.length > 0);
			const firstMessage = textMessages.find(({ role }) => role === "user")?.text ?? "(no messages)";
			const lastMessage = textMessages.at(-1);
			const info: SessionHistoryInfo = {
				id: document.header.id,
				path: sessionPath,
				cwd: document.header.cwd,
				name: readSessionName(document.entries),
				firstMessage,
				modifiedAt: readLastActivityTime(messages) ?? readTimestamp(document.header.timestamp) ?? fileModifiedAt,
				lastMessagePreview: lastMessage?.text.trim().slice(0, 120) ?? "",
				parentSessionPath: document.header.parentSession,
				parentEntryId: document.header.parentEntryId,
			};
			rememberLegacySessionInfo(sessionPath, fileModifiedAt, info);
			return info;
		} catch {
			return undefined;
		}
	}

	private createEntryId(existingIds: ReadonlySet<string>): string {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const id = this.host.createRandomId().slice(0, 8);
			if (!existingIds.has(id)) return id;
		}
		return this.host.createRandomId();
	}
}

interface LegacyConversationMessage {
	readonly role: "user" | "assistant";
	readonly text: string;
	readonly timestamp?: number;
}

function readConversationMessage(entry: CodingAgentSessionEntry): readonly LegacyConversationMessage[] {
	if (entry.type !== "message") return [];
	const role = Reflect.get(entry.message, "role");
	if (role !== "user" && role !== "assistant") return [];
	const content = Reflect.get(entry.message, "content");
	const text = extractTextContent(content);
	const messageTimestamp = Reflect.get(entry.message, "timestamp");
	return [
		{
			role,
			text,
			timestamp: typeof messageTimestamp === "number" ? messageTimestamp : readTimestamp(entry.timestamp),
		},
	];
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (typeof block !== "object" || block === null || Reflect.get(block, "type") !== "text") return [];
			const text = Reflect.get(block, "text");
			return typeof text === "string" ? [text] : [];
		})
		.join(" ");
}

function readSessionName(entries: readonly CodingAgentSessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "session_info" && entry.name) return entry.name.trim();
	}
	return undefined;
}

function readLastActivityTime(messages: readonly LegacyConversationMessage[]): number | undefined {
	let lastActivityTime: number | undefined;
	for (const message of messages) {
		if (message.timestamp === undefined) continue;
		lastActivityTime = Math.max(lastActivityTime ?? 0, message.timestamp);
	}
	return lastActivityTime && lastActivityTime > 0 ? lastActivityTime : undefined;
}

function readTimestamp(value: string): number | undefined {
	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : undefined;
}
