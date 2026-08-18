import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialGeneralApi } from "./plugin-official-general.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialGeneralApi", () => {
	it("routes general settings through the plugin capability session", async () => {
		const settings = {
			workspacePath: "C:/workspace",
			defaultExecutionMode: "full-access" as const,
			notificationsEnabled: true,
			debugMode: false,
			sandbox: { status: "available", backend: "windows-host", platform: "win32" },
		};
		const generalSettings = {
			get: vi.fn().mockResolvedValue(settings),
			setNotifications: vi.fn().mockResolvedValue({ enabled: false }),
			setDefaultExecutionMode: vi.fn().mockResolvedValue({ mode: "sandbox" }),
			setWorkspace: vi.fn().mockResolvedValue({ path: "C:/next" }),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { generalSettings } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialGeneralApi(assertOfficial, "capability-session");

		await expect(api.getSettings()).resolves.toEqual(settings);
		await expect(api.setSettings({ operation: "set-notifications", enabled: false })).resolves.toEqual({
			operation: "set-notifications",
			enabled: false,
		});
		await expect(api.setSettings({ operation: "set-execution-mode", mode: "sandbox" })).resolves.toEqual({
			operation: "set-execution-mode",
			mode: "sandbox",
		});
		await expect(api.setSettings({ operation: "set-workspace", path: "C:/next" })).resolves.toEqual({
			operation: "set-workspace",
			path: "C:/next",
		});

		expect(assertOfficial).toHaveBeenCalledTimes(4);
		expect(generalSettings.get).toHaveBeenCalledWith("capability-session");
		expect(generalSettings.setNotifications).toHaveBeenCalledWith("capability-session", false);
		expect(generalSettings.setDefaultExecutionMode).toHaveBeenCalledWith("capability-session", "sandbox");
		expect(generalSettings.setWorkspace).toHaveBeenCalledWith("capability-session", "C:/next");
	});
});
