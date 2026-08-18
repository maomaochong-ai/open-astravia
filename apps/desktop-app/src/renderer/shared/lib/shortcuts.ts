/**
 * Renderer 侧全局快捷键：定义 re-export + 持久化（desktop-config）+ localStorage 迁移。
 * 快捷面板不在此模块。
 */

import {
	getEffectiveShortcut as getEffectiveFromShared,
	isShortcutActionId,
	listShortcutBindingsSnapshot,
	normalizeShortcutBindings,
	SHORTCUT_ACTIONS,
	type ShortcutActionId,
	type ShortcutBindings,
} from "@/shared/shortcuts";

export { SHORTCUT_ACTIONS, type ShortcutActionId, type ShortcutBindings, listShortcutBindingsSnapshot };
export type { ShortcutActionDef } from "@/shared/shortcuts";

/** @deprecated 使用 ShortcutBindings；保留别名避免旧 import 断裂。 */
export type ShortcutMap = ShortcutBindings;

const LEGACY_STORAGE_KEY = "vetta-shortcuts";

function bindingsAsRecord(bindings: ShortcutBindings): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(bindings)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

function readLegacyLocalStorage(): ShortcutBindings {
	try {
		const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return {};
		return normalizeShortcutBindings(JSON.parse(raw) as unknown);
	} catch {
		return {};
	}
}

function clearLegacyLocalStorage(): void {
	try {
		localStorage.removeItem(LEGACY_STORAGE_KEY);
	} catch {
		// ignore
	}
}

/** 从 desktop-config 加载；若为空则迁移旧 localStorage 一次。 */
export async function loadShortcutBindings(): Promise<ShortcutBindings> {
	const config = await window.vetta.config.get();
	const fromConfig = normalizeShortcutBindings(config.shortcuts?.bindings ?? {});
	if (Object.keys(fromConfig).length > 0) {
		clearLegacyLocalStorage();
		return fromConfig;
	}
	const legacy = readLegacyLocalStorage();
	if (Object.keys(legacy).length > 0) {
		await window.vetta.config.set({ shortcuts: { bindings: bindingsAsRecord(legacy) } });
		clearLegacyLocalStorage();
		return legacy;
	}
	clearLegacyLocalStorage();
	return {};
}

/** 整表写入自定义绑定（空对象 = 全部默认）。 */
export async function saveShortcutBindings(bindings: ShortcutBindings): Promise<void> {
	const normalized = normalizeShortcutBindings(bindings);
	await window.vetta.config.set({ shortcuts: { bindings: bindingsAsRecord(normalized) } });
}

export function getEffectiveShortcut(actionId: string, customMap: ShortcutBindings): string {
	if (!isShortcutActionId(actionId)) return "";
	return getEffectiveFromShared(actionId, customMap);
}

export async function resetShortcut(actionId: string, customMap: ShortcutBindings): Promise<ShortcutBindings> {
	if (!isShortcutActionId(actionId)) return customMap;
	const next: ShortcutBindings = { ...customMap };
	delete next[actionId];
	await saveShortcutBindings(next);
	return next;
}

export async function resetAllShortcuts(): Promise<ShortcutBindings> {
	await saveShortcutBindings({});
	return {};
}
