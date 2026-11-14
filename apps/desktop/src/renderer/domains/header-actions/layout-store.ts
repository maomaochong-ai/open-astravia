import { atom } from "jotai";
import type { HeaderLayout } from "./layout";

/** 本机存储键。内容是 `{ top: string[]; tray: string[] }`，key 为 `builtin:*` 或 `<pluginId>:<actionId>`。 */
export const HEADER_ACTION_LAYOUT_STORAGE_KEY = "astravia-header-action-layout";

export function parseHeaderLayout(raw: string | null): HeaderLayout | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as { top?: unknown; tray?: unknown };
		const isKeys = (list: unknown): list is string[] =>
			Array.isArray(list) && list.every((key) => typeof key === "string");
		if (!isKeys(value.top) || !isKeys(value.tray)) return null;
		return { top: value.top, tray: value.tray };
	} catch {
		return null;
	}
}

function readStored(): HeaderLayout | null {
	try {
		return parseHeaderLayout(localStorage.getItem(HEADER_ACTION_LAYOUT_STORAGE_KEY));
	} catch {
		return null;
	}
}

const baseAtom = atom<HeaderLayout | null>(readStored());

/** 用户保存的顶栏布局；`null` 表示从没调整过（全部走默认顺序）。写入同时落到 localStorage。 */
export const headerActionLayoutAtom = atom(
	(get) => get(baseAtom),
	(_get, set, next: HeaderLayout | null) => {
		set(baseAtom, next);
		try {
			if (next) localStorage.setItem(HEADER_ACTION_LAYOUT_STORAGE_KEY, JSON.stringify(next));
			else localStorage.removeItem(HEADER_ACTION_LAYOUT_STORAGE_KEY);
		} catch {
			// 存储不可用（隐私模式等）时本次会话内仍然生效。
		}
	},
);
