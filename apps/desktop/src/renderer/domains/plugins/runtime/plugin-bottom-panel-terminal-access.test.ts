// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

function registerPanel(declared: PluginPermission[], granted: PluginPermission[] = declared) {
	const contributions = new PluginLocalContributions();
	const plugin = {
		id: "scripts",
		name: "Scripts",
		permissions: declared,
		grantedPermissions: granted,
	} as unknown as InstalledPlugin;
	const ui = createPluginUiApi({
		plugin,
		contributions,
		onChanged: () => {},
		disposers: [],
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
	ui.registerBottomPanel({ id: "scripts", label: "Scripts", component: () => null, scope_use: ["project"] });
	return contributions.bottomPanels;
}

describe("底部面板的终端权限", () => {
	it("声明并被授予 terminal.run 的插件，面板可以开终端", () => {
		expect(registerPanel(["ui.slot.bottom-panel", "terminal.run"])[0]?.terminalAccess).toBe(true);
	});

	it("没声明或用户撤销了 terminal.run 时面板照常注册，只是不能开终端", () => {
		expect(registerPanel(["ui.slot.bottom-panel"])[0]?.terminalAccess).toBe(false);
		const revoked = registerPanel(["ui.slot.bottom-panel", "terminal.run"], ["ui.slot.bottom-panel"]);
		expect(revoked).toHaveLength(1);
		expect(revoked[0]?.terminalAccess).toBe(false);
	});
});
