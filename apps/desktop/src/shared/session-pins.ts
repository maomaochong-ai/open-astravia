/**
 * 会话置顶的纯领域模型。
 *
 * 置顶按会话文件路径记录，与会话内容无关（重命名只追加 name 条目，路径不变）。
 * 主进程仓库 `~/.vetta/desktop-app/session-pins.json` 是唯一写者，侧边栏与配对的
 * 手机都读它；这里只放不依赖 fs/electron 的纯函数，两个进程共用同一套语义。
 */

export const SESSION_PINS_SCHEMA_VERSION = 1;

/** 置顶变更广播通道：主进程在每次写盘后推送最新快照。 */
export const SESSION_PINS_CHANGED_CHANNEL = "vetta:session-pins:changed";

/** 会话路径 → 置顶时间（epoch ms），越新越靠前。 */
export type SessionPins = ReadonlyMap<string, number>;

export interface SessionPinsSnapshot {
	pins: ReadonlyArray<{ path: string; pinnedAt: number }>;
}

export function emptySessionPins(): SessionPins {
	return new Map();
}

export function parseSessionPins(value: unknown): Map<string, number> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
	const input = value as { schemaVersion?: unknown; pins?: unknown };
	if (input.schemaVersion !== SESSION_PINS_SCHEMA_VERSION || !Array.isArray(input.pins)) return new Map();
	return readPinEntries(input.pins);
}

/** 快照（跨进程传输的形状）转回 Map；无效条目丢弃。 */
export function sessionPinsFromSnapshot(snapshot: SessionPinsSnapshot | undefined): Map<string, number> {
	return readPinEntries(Array.isArray(snapshot?.pins) ? snapshot.pins : []);
}

export function toSessionPinsSnapshot(pins: SessionPins): SessionPinsSnapshot {
	return { pins: Array.from(pins, ([path, pinnedAt]) => ({ path, pinnedAt })) };
}

export function serializeSessionPins(pins: SessionPins): { schemaVersion: number } & SessionPinsSnapshot {
	return { schemaVersion: SESSION_PINS_SCHEMA_VERSION, ...toSessionPinsSnapshot(pins) };
}

/** 时钟不前进时新置顶仍排在最前：置顶时间单调递增。 */
export function setSessionPinned(
	current: SessionPins,
	input: { path: string; pinned: boolean; pinnedAt?: number },
): Map<string, number> {
	const next = new Map(current);
	if (input.pinned) {
		let latestPin = 0;
		for (const pinnedAt of current.values()) latestPin = Math.max(latestPin, pinnedAt);
		next.set(input.path, input.pinnedAt ?? Math.max(Date.now(), latestPin + 1));
	} else next.delete(input.path);
	return next;
}

export function removeSessionPins(current: SessionPins, paths: Iterable<string>): SessionPins {
	let next: Map<string, number> | undefined;
	for (const path of paths) {
		if (!current.has(path)) continue;
		next ??= new Map(current);
		next.delete(path);
	}
	return next ?? current;
}

/** 合并旧版本留在渲染进程 localStorage 里的置顶；同一路径取较新的时间。 */
export function mergeSessionPins(current: SessionPins, incoming: SessionPins): SessionPins {
	let next: Map<string, number> | undefined;
	for (const [path, pinnedAt] of incoming) {
		if ((current.get(path) ?? 0) >= pinnedAt) continue;
		next ??= new Map(current);
		next.set(path, pinnedAt);
	}
	return next ?? current;
}

function readPinEntries(entries: readonly unknown[]): Map<string, number> {
	const pins = new Map<string, number>();
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const path = Reflect.get(entry, "path");
		const pinnedAt = Reflect.get(entry, "pinnedAt");
		if (typeof path !== "string" || path.trim().length === 0) continue;
		if (typeof pinnedAt !== "number" || !Number.isFinite(pinnedAt) || pinnedAt <= 0) continue;
		pins.set(path, pinnedAt);
	}
	return pins;
}
