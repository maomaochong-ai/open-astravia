import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectInfo, RuntimeSessionCatalog, SessionHistoryInfo } from "@vetta/runtime-core";
import { getSessionsDir } from "../../config.js";
import type { CodingAgentSessionEntry } from "../contracts/session-entry.js";
import { readCodingAgentLegacySessionDocument } from "./document.js";
import { isLegacySessionFile } from "./header-reader.js";
import { acquireLegacySessionFormatLease } from "./lease.js";

/** 旧 Coding Agent JSONL 的发现、命名与删除适配；不创建 AgentSession。 */
export class LegacyRuntimeSessionCatalog implements RuntimeSessionCatalog {
	ownsSession(sessionPath: string): Promise<boolean> {
		return isLegacySessionFile(sessionPath);
	}

	async listProjects(): Promise<ProjectInfo[]> {
		const sessions = await listAllLegacySessions();
		const byCwd = new Map<string, number>();
		for (const session of sessions) {
			const cwd = session.cwd || process.cwd();
			byCwd.set(cwd, (byCwd.get(cwd) ?? 0) + 1);
		}
		return Array.from(byCwd, ([cwd, sessionCount]) => ({ cwd, sessionCount })).sort((left, right) =>
			left.cwd.localeCompare(right.cwd),
		);
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		return listLegacySessionsFromDirectory(sessionDir ?? resolveLegacySessionDirectory(cwd));
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		const leaseResult = acquireLegacySessionFormatLease(sessionPath);
		if (leaseResult.kind === "locked") {
			throw new Error(
				`Session file is in use by another process (pid ${leaseResult.holder.pid}@${leaseResult.holder.hostname}). ` +
					`Lock file: ${leaseResult.lockPath}`,
			);
		}
		try {
			const document = readCodingAgentLegacySessionDocument(sessionPath);
			const ids = new Set(document.entries.map(({ id }) => id));
			await appendFile(
				sessionPath,
				`${JSON.stringify({
					type: "session_info",
					id: createEntryId(ids),
					parentId: document.activeLeafId,
					timestamp: new Date().toISOString(),
					name: name.trim(),
				})}\n`,
				"utf8",
			);
		} finally {
			leaseResult.lease.release();
		}
	}

	async deleteSessionArtifacts(sessionPath: string): Promise<void> {
		await rm(sessionPath, { force: true });
		await rm(`${sessionPath}.lock`, { force: true });
	}
}

function resolveLegacySessionDirectory(cwd: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(getSessionsDir(), safePath);
}

async function listAllLegacySessions(): Promise<SessionHistoryInfo[]> {
	const sessionsDirectory = getSessionsDir();
	if (!existsSync(sessionsDirectory)) return [];
	try {
		const entries = await readdir(sessionsDirectory, { withFileTypes: true });
		const lists = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => listLegacySessionsFromDirectory(join(sessionsDirectory, entry.name))),
		);
		return lists.flat().sort((left, right) => right.modifiedAt - left.modifiedAt);
	} catch {
		return [];
	}
}

async function listLegacySessionsFromDirectory(directory: string): Promise<SessionHistoryInfo[]> {
	if (!existsSync(directory)) return [];
	try {
		const names = await readdir(directory);
		const sessions = await Promise.all(
			names
				.filter((name) => name.endsWith(".jsonl"))
				.map((name) => buildLegacySessionHistoryInfo(join(directory, name))),
		);
		return sessions
			.filter((session): session is SessionHistoryInfo => session !== undefined)
			.sort((left, right) => right.modifiedAt - left.modifiedAt);
	} catch {
		return [];
	}
}

async function buildLegacySessionHistoryInfo(sessionPath: string): Promise<SessionHistoryInfo | undefined> {
	try {
		if (!(await isLegacySessionFile(sessionPath))) return undefined;
		const document = readCodingAgentLegacySessionDocument(sessionPath);
		const fileStats = await stat(sessionPath);
		const messages = document.entries.flatMap((entry) => readConversationMessage(entry));
		const textMessages = messages.filter(({ text }) => text.length > 0);
		const firstMessage = textMessages.find(({ role }) => role === "user")?.text ?? "(no messages)";
		const lastMessage = textMessages.at(-1);
		return {
			id: document.header.id,
			path: sessionPath,
			cwd: document.header.cwd,
			name: readSessionName(document.entries),
			firstMessage,
			modifiedAt: readLastActivityTime(messages) ?? readTimestamp(document.header.timestamp) ?? fileStats.mtimeMs,
			lastMessagePreview: lastMessage?.text.trim().slice(0, 120) ?? "",
			parentSessionPath: document.header.parentSession,
			parentEntryId: document.header.parentEntryId,
		};
	} catch {
		return undefined;
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

function createEntryId(existingIds: ReadonlySet<string>): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = randomUUID().slice(0, 8);
		if (!existingIds.has(id)) return id;
	}
	return randomUUID();
}
