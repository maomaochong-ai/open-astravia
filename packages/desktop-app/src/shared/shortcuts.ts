/**
 * 全局应用快捷键（设置 → 快捷键 → 全局快捷键）。
 * 与快捷面板（quickPanel）无关：后者是独立域，勿混写。
 */

export interface ShortcutActionDef {
	id: string;
	/** settings ns i18n key；模块级常量不存中文。 */
	labelKey: string;
	descriptionKey: string;
	defaultShortcut: string;
}

export const FILE_EDITOR_SAVE_EVENT = "vetta:file-editor-save";

/** 可配置的全局快捷键动作（白名单）。as const 保留字面量类型。 */
export const SHORTCUT_ACTIONS = [
	{
		id: "new-session",
		labelKey: "shortcutNewSessionLabel",
		descriptionKey: "shortcutNewSessionDesc",
		defaultShortcut: "mod+n",
	},
	{
		id: "open-project",
		labelKey: "shortcutOpenProjectLabel",
		descriptionKey: "shortcutOpenProjectDesc",
		defaultShortcut: "mod+o",
	},
	{
		id: "open-settings",
		labelKey: "shortcutOpenSettingsLabel",
		descriptionKey: "shortcutOpenSettingsDesc",
		defaultShortcut: "mod+,",
	},
	{
		id: "save-file",
		labelKey: "shortcutSaveFileLabel",
		descriptionKey: "shortcutSaveFileDesc",
		defaultShortcut: "mod+s",
	},
] as const satisfies readonly ShortcutActionDef[];

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];

/** 自定义绑定：actionId → 序列化组合键（如 mod+shift+n）。缺省 id 表示用默认键。 */
export type ShortcutBindings = Partial<Record<ShortcutActionId, string>>;

export interface ShortcutsConfig {
	bindings?: ShortcutBindings;
}

const SHORTCUT_ACTION_IDS = new Set<string>(SHORTCUT_ACTIONS.map((action) => action.id));

const MODIFIER_TOKENS = new Set(["mod", "shift", "alt", "ctrl"]);

export function isShortcutActionId(value: unknown): value is ShortcutActionId {
	return typeof value === "string" && SHORTCUT_ACTION_IDS.has(value);
}

export function getShortcutActionDef(id: ShortcutActionId): (typeof SHORTCUT_ACTIONS)[number] {
	const found = SHORTCUT_ACTIONS.find((action) => action.id === id);
	if (!found) {
		throw new Error(`Unknown shortcut action: ${id}`);
	}
	return found;
}

/**
 * 校验序列化快捷键。格式：`mod+shift+alt+ctrl+key`（修饰键可选，顺序任意，key 必填小写）。
 * 与 renderer `eventToShortcut` 产物对齐。
 */
export function isValidShortcutCombo(value: string): boolean {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed || trimmed.includes(" ")) return false;
	const parts = trimmed.split("+").filter(Boolean);
	if (parts.length === 0) return false;

	const key = parts[parts.length - 1];
	if (!key || MODIFIER_TOKENS.has(key)) return false;
	// 单字符（含 `,` 等）或命名键（escape、enter、f1…）
	if (key.length > 24) return false;

	const mods = parts.slice(0, -1);
	const seen = new Set<string>();
	for (const mod of mods) {
		if (!MODIFIER_TOKENS.has(mod) || seen.has(mod)) return false;
		seen.add(mod);
	}
	return true;
}

export function normalizeShortcutCombo(value: string): string {
	const parts = value.trim().toLowerCase().split("+").filter(Boolean);
	const key = parts[parts.length - 1] ?? "";
	const mods = parts.slice(0, -1);
	const ordered: string[] = [];
	for (const token of ["mod", "ctrl", "shift", "alt"] as const) {
		if (mods.includes(token)) ordered.push(token);
	}
	return [...ordered, key].join("+");
}

export function getEffectiveShortcut(actionId: ShortcutActionId, bindings: ShortcutBindings = {}): string {
	const custom = bindings[actionId];
	if (typeof custom === "string" && custom.length > 0) return custom;
	return getShortcutActionDef(actionId).defaultShortcut;
}

/** 仅保留合法 actionId + 合法 combo 的绑定；非法项丢弃。 */
export function normalizeShortcutBindings(value: unknown): ShortcutBindings {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	const raw = value as Record<string, unknown>;
	const result: ShortcutBindings = {};
	for (const action of SHORTCUT_ACTIONS) {
		const combo = raw[action.id];
		if (typeof combo !== "string") continue;
		const normalized = normalizeShortcutCombo(combo);
		if (!isValidShortcutCombo(normalized)) continue;
		// 与默认相同则不写入，保持 isDefault 语义干净
		if (normalized === action.defaultShortcut) continue;
		result[action.id] = normalized;
	}
	return result;
}

export function normalizeShortcutsConfig(value: unknown): ShortcutsConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { bindings: {} };
	}
	const raw = value as Record<string, unknown>;
	return { bindings: normalizeShortcutBindings(raw.bindings ?? raw) };
}

/** 查找与 candidate 冲突的其它 action（比较生效后的键）。 */
export function findShortcutBindingConflict(
	actionId: ShortcutActionId,
	candidate: string,
	bindings: ShortcutBindings,
): ShortcutActionId | null {
	const normalized = normalizeShortcutCombo(candidate);
	for (const action of SHORTCUT_ACTIONS) {
		if (action.id === actionId) continue;
		if (getEffectiveShortcut(action.id, bindings) === normalized) {
			return action.id;
		}
	}
	return null;
}

export function listShortcutBindingsSnapshot(bindings: ShortcutBindings = {}) {
	return SHORTCUT_ACTIONS.map((action) => {
		const shortcut = getEffectiveShortcut(action.id, bindings);
		const isDefault = bindings[action.id] === undefined;
		return {
			id: action.id,
			defaultShortcut: action.defaultShortcut,
			shortcut,
			isDefault,
		};
	});
}
