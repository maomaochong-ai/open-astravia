import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	activeSend: vi.fn(),
	destroyedSend: vi.fn(),
	refreshAgentPlugins: vi.fn(),
}));

vi.mock("electron", () => ({
	webContents: {
		getAllWebContents: () => [
			{ isDestroyed: () => false, send: mocks.activeSend },
			{ isDestroyed: () => true, send: mocks.destroyedSend },
		],
	},
}));
vi.mock("./plugin-runtime-service.js", () => ({ refreshAgentPlugins: mocks.refreshAgentPlugins }));

import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { publishPluginSettingsChanged } from "./plugin-settings-events.js";

describe("publishPluginSettingsChanged", () => {
	beforeEach(() => vi.clearAllMocks());

	it("refreshes Agent plugins and sends the complete effective settings to active renderers", () => {
		const values = { username: "account", password: "complete-password" };
		publishPluginSettingsChanged("jsk-map", values);

		expect(mocks.refreshAgentPlugins).toHaveBeenCalledWith({
			reason: "contribution:settings-change",
			pluginId: "jsk-map",
		});
		expect(mocks.activeSend).toHaveBeenCalledWith(PLUGIN_CONTRIBUTION_CHANNELS.SETTINGS_CHANGED, {
			pluginId: "jsk-map",
			values,
		});
		expect(mocks.destroyedSend).not.toHaveBeenCalled();
	});
});
