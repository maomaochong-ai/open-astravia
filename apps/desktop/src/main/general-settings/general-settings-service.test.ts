import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notification-preferences.js";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { GeneralSettingsService } from "./general-settings-service.js";

function createConfig(): DesktopConfig {
	return {
		schemaVersion: 2,
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		debugMode: true,
		notificationsEnabled: true,
		notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
	};
}

describe("GeneralSettingsService", () => {
	it("returns a stable general settings snapshot", async () => {
		const service = new GeneralSettingsService({
			readConfig: async () => createConfig(),
			updateConfig: vi.fn(),
			allowWorkspaceRoot: vi.fn(),
			getSandbox: () => ({ status: "available", backend: "windows-host", platform: "win32" }),
		});

		await expect(service.getSettings()).resolves.toEqual({
			workspacePath: "C:\\workspace",
			defaultExecutionMode: "full-access",
			notificationsEnabled: true,
			debugMode: true,
			sandbox: { status: "available", backend: "windows-host", platform: "win32" },
		});
	});

	it("updates one setting without dropping adjacent config", async () => {
		const updateConfig = vi.fn(async (update: (current: DesktopConfig) => DesktopConfig | Promise<DesktopConfig>) =>
			update(createConfig()),
		);
		const service = new GeneralSettingsService({
			readConfig: async () => createConfig(),
			updateConfig,
			allowWorkspaceRoot: vi.fn(),
			getSandbox: () => ({ status: "unknown", backend: null, platform: "win32" }),
		});

		await expect(service.setNotifications(false)).resolves.toEqual({ enabled: false });
		expect(await updateConfig.mock.results[0]?.value).toEqual({ ...createConfig(), notificationsEnabled: false });
	});

	it("normalizes and authorizes absolute workspace paths", async () => {
		const updateConfig = vi.fn(async (update: (current: DesktopConfig) => DesktopConfig | Promise<DesktopConfig>) =>
			update(createConfig()),
		);
		const allowWorkspaceRoot = vi.fn();
		const service = new GeneralSettingsService({
			readConfig: async () => createConfig(),
			updateConfig,
			allowWorkspaceRoot,
			getSandbox: () => ({ status: "unknown", backend: null, platform: "win32" }),
		});

		await expect(service.setWorkspace("  C:\\next  ")).resolves.toEqual({ path: "C:\\next" });
		expect(allowWorkspaceRoot).toHaveBeenCalledWith("C:\\next");
		expect(await updateConfig.mock.results[0]?.value).toEqual({ ...createConfig(), workspacePath: "C:\\next" });
		await expect(service.setWorkspace("relative/path")).rejects.toThrow("workspace path must be absolute");
	});
});
