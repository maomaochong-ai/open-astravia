import { describe, expect, it } from "vitest";
import {
	findShortcutBindingConflict,
	getEffectiveShortcut,
	isShortcutActionId,
	isValidShortcutCombo,
	normalizeShortcutCombo,
	SHORTCUT_ACTIONS,
} from "./shortcuts.js";

describe("SHORTCUT_ACTIONS", () => {
	it("keeps every default combo valid and already normalized", () => {
		for (const action of SHORTCUT_ACTIONS) {
			expect(isValidShortcutCombo(action.defaultShortcut), action.id).toBe(true);
			expect(normalizeShortcutCombo(action.defaultShortcut), action.id).toBe(action.defaultShortcut);
		}
	});

	it("has no duplicate default bindings inside the same scope", () => {
		for (const action of SHORTCUT_ACTIONS) {
			expect(findShortcutBindingConflict(action.id, action.defaultShortcut, {}), action.id).toBeNull();
		}
	});

	it("exposes UI zoom as app-scope actions, because non-mac builds have no menu", () => {
		// Windows/Linux 没有菜单栏，`app-menu.ts` 在非 mac 上不建菜单，
		// 所以缩放只能靠这三个 app 作用域的动作。
		for (const id of ["zoom-in", "zoom-out", "zoom-reset"] as const) {
			expect(isShortcutActionId(id)).toBe(true);
			expect(getEffectiveShortcut(id)).toMatch(/^mod\+/);
			expect(SHORTCUT_ACTIONS.find((action) => action.id === id)?.scope).toBe("app");
		}
	});

	it("uses = for zoom-in so the combo survives formatShortcut's split on +", () => {
		expect(getEffectiveShortcut("zoom-in")).toBe("mod+=");
		expect(getEffectiveShortcut("zoom-out")).toBe("mod+-");
		expect(getEffectiveShortcut("zoom-reset")).toBe("mod+0");
	});
});
