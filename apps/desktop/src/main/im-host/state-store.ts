import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type { SessionStateEntry } from "./host-protocol.js";

/**
 * Persistent IM routing table. Mirror of the in-memory MemoryStore inside
 * the sidecar. The sidecar streams state_patch events on every change; we
 * apply them here and atomically rewrite the file. On sidecar (re)start we
 * read this file and replay the snapshot via the init frame.
 *
 * Path: ~/.vetta/desktop-app/im-state.json
 *
 * Schema v3: keyed by (userId, chatId). v3 supersedes v2 in everything but
 * version number — ADR-0005 split im-gateway's cwd from the desktop "对话"
 * cwd, which makes every v2 entry's `sessionPath` (pointing into the old
 * shared cwd) a dead reference. Pre-v3 files are dropped on load so each
 * chat starts a brand-new session in the new IM cwd on its next message.
 */
export interface ImStateFile {
	version: 3;
	sessions: SessionStateEntry[];
}

const STATE_VERSION = 3;
const DEFAULT_PATH = join(getVettaHomePath(), "desktop-app", "im-state.json");

export function defaultImStatePath(): string {
	return DEFAULT_PATH;
}

export function loadImState(filePath = DEFAULT_PATH): ImStateFile {
	if (!existsSync(filePath)) {
		return { version: STATE_VERSION, sessions: [] };
	}
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as { version?: number; sessions?: unknown };
		if (parsed.version !== STATE_VERSION) {
			// v1 用 projectId（ADR-0004），v2 用旧的共享 cwd 路径（ADR-0005）。两者都
			// 不能向 v3 迁移——sessionPath 已经是死引用，直接重置让每个 chat 重起。
			return { version: STATE_VERSION, sessions: [] };
		}
		return {
			version: STATE_VERSION,
			sessions: Array.isArray(parsed.sessions) ? (parsed.sessions as SessionStateEntry[]) : [],
		};
	} catch {
		return { version: STATE_VERSION, sessions: [] };
	}
}

export function saveImState(state: ImStateFile, filePath = DEFAULT_PATH): void {
	atomicWriteJSON(filePath, state);
}

/**
 * Apply a single state_patch and return the new state. Empty sessionPath
 * means "delete this entry"; otherwise upsert.
 */
export function applyStatePatch(state: ImStateFile, patch: SessionStateEntry): ImStateFile {
	const sessions = state.sessions.filter((s) => !(s.userId === patch.userId && s.chatId === patch.chatId));
	if (patch.sessionPath) {
		sessions.push(patch);
	}
	return { version: STATE_VERSION, sessions };
}
