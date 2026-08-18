import { randomUUID } from "node:crypto";
import { type FileHandle, mkdir, open } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_CONVERSATION_SESSION_DIR,
	DEFAULT_IM_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_SESSION_DIR,
	KB_PROCESSING_CWD,
	KB_PROCESSING_SESSION_DIR,
} from "../config/desktop-config-store.js";

const SESSION_HEADER_READ_BYTES = 64 * 1024;

export interface DesktopSessionHeader {
	type: "session";
	cwd: string;
}

export function resolveSessionDirForCwd(cwd: string | undefined): string | undefined {
	if (!cwd) return undefined;
	const abs = resolve(cwd);
	if (abs === resolve(DEFAULT_CONVERSATION_CWD)) {
		return DEFAULT_CONVERSATION_SESSION_DIR;
	}
	if (abs === resolve(DEFAULT_IM_CONVERSATION_CWD)) {
		return DEFAULT_IM_CONVERSATION_SESSION_DIR;
	}
	if (abs === resolve(KB_PROCESSING_CWD)) {
		return KB_PROCESSING_SESSION_DIR;
	}
	return undefined;
}

export function isConversationSubCwd(cwd: string): boolean {
	const abs = resolve(cwd);
	const root = resolve(DEFAULT_CONVERSATION_CWD);
	if (abs === root) return false;
	const rel = relative(root, abs).replace(/\\/g, "/");
	return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel) && !rel.includes("/");
}

export function isConversationCwd(cwd: string): boolean {
	return resolve(cwd) === resolve(DEFAULT_CONVERSATION_CWD) || isConversationSubCwd(cwd);
}

export function resolveSessionListCwd(cwd: string): string {
	if (isConversationCwd(cwd)) return DEFAULT_CONVERSATION_CWD;
	const absoluteCwd = resolve(cwd);
	if (absoluteCwd === resolve(DEFAULT_IM_CONVERSATION_CWD)) return DEFAULT_IM_CONVERSATION_CWD;
	if (absoluteCwd === resolve(KB_PROCESSING_CWD)) return KB_PROCESSING_CWD;
	return cwd;
}

export async function ensureConversationSubCwd(requestedCwd: string | undefined): Promise<string | undefined> {
	if (!requestedCwd) return requestedCwd;
	if (resolve(requestedCwd) !== resolve(DEFAULT_CONVERSATION_CWD)) return requestedCwd;
	const sub = join(DEFAULT_CONVERSATION_CWD, randomUUID());
	await mkdir(sub, { recursive: true });
	return sub;
}

export async function ensureSessionWorkingCwd(cwd: string | undefined): Promise<void> {
	if (!cwd) return;
	await mkdir(cwd, { recursive: true });
}

export async function readDesktopSessionHeader(sessionPath: string): Promise<DesktopSessionHeader | undefined> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(sessionPath, "r");
		const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const text = buffer.toString("utf8", 0, bytesRead);
		const newline = text.indexOf("\n");
		if (newline === -1 && bytesRead === buffer.length) return undefined;
		const firstLine = newline === -1 ? text : text.slice(0, newline);
		if (!firstLine) return undefined;
		const header = JSON.parse(firstLine) as {
			type?: unknown;
			recordType?: unknown;
			cwd?: unknown;
		};
		const supportedHeader = header.type === "session" || header.recordType === "conversation.header";
		if (
			!supportedHeader ||
			typeof header.cwd !== "string" ||
			header.cwd.trim().length === 0 ||
			!isAbsolute(header.cwd)
		) {
			return undefined;
		}
		return { type: "session", cwd: header.cwd };
	} catch {
		return undefined;
	} finally {
		await handle?.close();
	}
}

export async function readSessionCwdFromHeader(sessionPath: string): Promise<string | undefined> {
	return (await readDesktopSessionHeader(sessionPath))?.cwd;
}

/** 会话工作区目录名由 {@link ensureConversationSubCwd} 以 randomUUID() 生成。 */
const WORKSPACE_DIR_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 「对话」根目录下 uuid 命名的会话工作区子目录是内部状态，不应出现在文件面板、
 * @文件补全等 UI 目录列举中；根目录下的老产物（非 uuid 命名）仍保持可见。
 * 只隐藏展示，不收紧 fs 权限边界——显式绝对路径（如 mentionedFile 拖拽）仍可读取。
 * 见 ADR-0007 修订。
 */
export function isConversationWorkspaceDirEntry(parentDir: string, entryName: string): boolean {
	if (resolve(parentDir) !== resolve(DEFAULT_CONVERSATION_CWD)) return false;
	return WORKSPACE_DIR_NAME_RE.test(entryName);
}
