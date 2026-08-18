import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialShortcutsApi } from "./plugin-official-shortcuts.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialShortcutsApi", () => {
	it("keeps the action catalog local and routes settings through the capability session", async () => {
		const settings = {
			bindings: [],
			quickPanel: { trigger: "none", postSendBehavior: "foreground" },
		};
		const shortcuts = {
			getSettings: vi.fn().mockResolvedValue(settings),
			setBinding: vi.fn().mockResolvedValue({ bindings: [] }),
			resetBinding: vi.fn().mockResolvedValue({ bindings: [], shortcut: "mod+n" }),
			resetAllBindings: vi.fn().mockResolvedValue({ bindings: [] }),
			setQuickPanelTrigger: vi.fn().mockResolvedValue({
				trigger: "mod",
				postSendBehavior: "foreground",
			}),
			setQuickPanelPostSendBehavior: vi.fn().mockResolvedValue({
				trigger: "mod",
				postSendBehavior: "background",
			}),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { shortcuts } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialShortcutsApi(assertOfficial, "capability-session");

		expect(api.listAvailableActions()).toEqual([
			{ id: "new-session", defaultShortcut: "mod+n" },
			{ id: "open-project", defaultShortcut: "mod+o" },
			{ id: "open-settings", defaultShortcut: "mod+," },
			{ id: "save-file", defaultShortcut: "mod+s" },
		]);
		await expect(api.get()).resolves.toEqual(settings);
		await expect(api.setBinding("new-session", "mod+shift+n")).resolves.toEqual({ bindings: [] });
		await expect(api.resetBinding("new-session")).resolves.toEqual({ bindings: [], shortcut: "mod+n" });
		await expect(api.resetAllBindings()).resolves.toEqual({ bindings: [] });
		await expect(api.setQuickPanelTrigger("mod")).resolves.toEqual({
			trigger: "mod",
			postSendBehavior: "foreground",
		});
		await expect(api.setQuickPanelBehavior("background")).resolves.toEqual({
			trigger: "mod",
			postSendBehavior: "background",
		});

		expect(assertOfficial).toHaveBeenCalledTimes(7);
		expect(shortcuts.getSettings).toHaveBeenCalledWith("capability-session");
		expect(shortcuts.setBinding).toHaveBeenCalledWith("capability-session", "new-session", "mod+shift+n");
		expect(shortcuts.resetBinding).toHaveBeenCalledWith("capability-session", "new-session");
		expect(shortcuts.resetAllBindings).toHaveBeenCalledWith("capability-session");
		expect(shortcuts.setQuickPanelTrigger).toHaveBeenCalledWith("capability-session", "mod");
		expect(shortcuts.setQuickPanelPostSendBehavior).toHaveBeenCalledWith("capability-session", "background");
	});
});
