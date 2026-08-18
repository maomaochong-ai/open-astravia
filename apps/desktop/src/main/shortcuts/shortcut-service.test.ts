import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { ShortcutService } from "./shortcut-service.js";

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../quickpanel-trigger.js", () => ({
	applyQuickPanelTrigger: vi.fn(),
	setQuickPanelTriggerHandler: vi.fn(),
}));

vi.mock("../quickpanel-window.js", () => ({
	toggleQuickPanelWindow: vi.fn(),
}));

function createFixture(initial?: Partial<DesktopConfig>) {
	let config: DesktopConfig = {
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		shortcuts: { bindings: {} },
		quickPanel: { trigger: "none", postSendBehavior: "foreground" },
		...initial,
	};
	const broadcastBindings = vi.fn();
	const reloadQuickPanelTrigger = vi.fn(async () => {});
	const service = new ShortcutService({
		readConfig: async () => structuredClone(config),
		writeConfig: async (next) => {
			config = structuredClone(next);
		},
		broadcastBindings,
		reloadQuickPanelTrigger,
	});
	return {
		broadcastBindings,
		getConfig: () => config,
		reloadQuickPanelTrigger,
		service,
	};
}

describe("ShortcutService", () => {
	it("normalizes bindings and rejects conflicts with effective defaults", async () => {
		const fixture = createFixture();

		await expect(fixture.service.setBinding("new-session", "mod+o")).rejects.toThrow(
			'Shortcut "mod+o" is already bound to "open-project".',
		);
		await expect(fixture.service.setBinding("new-session", "")).rejects.toThrow("Invalid shortcut combo: ");
		expect(fixture.broadcastBindings).not.toHaveBeenCalled();
	});

	it("persists custom bindings and removes overrides that match the default", async () => {
		const fixture = createFixture();

		await fixture.service.setBinding("new-session", "shift+mod+n");
		expect(fixture.getConfig().shortcuts?.bindings).toEqual({ "new-session": "mod+shift+n" });
		expect(fixture.broadcastBindings).toHaveBeenLastCalledWith({ "new-session": "mod+shift+n" });

		await fixture.service.setBinding("new-session", "mod+n");
		expect(fixture.getConfig().shortcuts?.bindings).toEqual({});
		expect(fixture.broadcastBindings).toHaveBeenLastCalledWith({});
	});

	it("updates quick panel settings without replacing the adjacent value and reloads the trigger", async () => {
		const fixture = createFixture({
			quickPanel: { trigger: "alt", postSendBehavior: "background" },
		});

		await expect(fixture.service.setQuickPanelTrigger("mod")).resolves.toEqual({
			trigger: "mod",
			postSendBehavior: "background",
		});
		expect(fixture.getConfig().quickPanel).toEqual({ trigger: "mod", postSendBehavior: "background" });

		await expect(fixture.service.setQuickPanelPostSendBehavior("foreground")).resolves.toEqual({
			trigger: "mod",
			postSendBehavior: "foreground",
		});
		expect(fixture.reloadQuickPanelTrigger).toHaveBeenCalledTimes(2);
	});
});
