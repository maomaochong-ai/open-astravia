import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import {
	emptySessionPins,
	mergeSessionPins,
	parseSessionPins,
	removeSessionPins,
	type SessionPins,
	serializeSessionPins,
	setSessionPinned,
} from "../../shared/session-pins.js";

/**
 * 会话置顶仓库：~/.vetta/desktop-app/session-pins.json 的单一写者。
 *
 * 侧边栏和配对的手机都经由这里读写，所以两边看到同一份置顶。启动读一次进
 * 内存，之后所有变更改内存再原子落盘；写入同步、中间没有 await，「读-改-写」
 * 不存在交错窗口。
 */

const DEFAULT_PATH = join(getVettaHomePath(), "desktop-app", "session-pins.json");

let cache: SessionPins | null = null;
let cachePath = DEFAULT_PATH;
const listeners = new Set<(pins: SessionPins) => void>();

function read(filePath: string): SessionPins {
	if (!existsSync(filePath)) return emptySessionPins();
	try {
		return parseSessionPins(JSON.parse(readFileSync(filePath, "utf-8")) as unknown);
	} catch {
		return emptySessionPins();
	}
}

function snapshot(filePath: string): SessionPins {
	if (cache === null || cachePath !== filePath) {
		cachePath = filePath;
		cache = read(filePath);
	}
	return cache;
}

function commit(filePath: string, next: SessionPins): SessionPins {
	const current = snapshot(filePath);
	if (next === current) return current;
	cache = next;
	try {
		atomicWriteJSON(filePath, serializeSessionPins(next));
	} catch {
		// 落盘失败时保留内存态，避免界面回滚到旧值；下一次变更会重试写入。
	}
	for (const listener of listeners) listener(next);
	return next;
}

export function onSessionPinsChanged(listener: (pins: SessionPins) => void): () => void {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

export function listSessionPins(filePath = DEFAULT_PATH): SessionPins {
	return snapshot(filePath);
}

export function pinSession(input: { path: string; pinned: boolean }, filePath = DEFAULT_PATH): SessionPins {
	const current = snapshot(filePath);
	// 再次置顶会刷新时间、回到最前（与侧边栏一致）；取消一个没置顶的会话什么也不做。
	if (!input.pinned && !current.has(input.path)) return current;
	return commit(filePath, setSessionPinned(current, input));
}

export function forgetSessionPins(paths: readonly string[], filePath = DEFAULT_PATH): SessionPins {
	return commit(filePath, removeSessionPins(snapshot(filePath), paths));
}

/** 旧版本把置顶存在渲染进程的 localStorage 里；首次启动时由渲染进程交上来合并。 */
export function importSessionPins(pins: SessionPins, filePath = DEFAULT_PATH): SessionPins {
	return commit(filePath, mergeSessionPins(snapshot(filePath), pins));
}

/** 仅供测试：丢弃内存缓存，下次访问重新读盘。 */
export function resetSessionPinsCache(): void {
	cache = null;
	cachePath = DEFAULT_PATH;
}
