// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createPluginFileExplorerApi } from "./plugin-file-explorer-context";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

const PERMISSIONS: PluginPermission[] = [
	"ui.slot.activity-tab",
	"ui.slot.new-session-context",
	"ui.slot.input-action",
	"ui.slot.message",
	"ui.file-explorer.context-menu",
	"ui.file-explorer.toolbar",
];

function createApis(iconUrl?: string) {
	const contributions = new PluginLocalContributions();
	const plugin = {
		id: "demo-plugin",
		name: "Demo",
		permissions: PERMISSIONS,
		grantedPermissions: PERMISSIONS,
		...(iconUrl === undefined ? {} : { iconUrl }),
	} as unknown as InstalledPlugin;
	const ui = createPluginUiApi({
		plugin,
		contributions,
		onChanged: () => {},
		disposers: [],
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
	const fileExplorer = createPluginFileExplorerApi({
		plugin,
		contributions,
		onChanged: () => {},
		disposers: [],
	});
	return { contributions, fileExplorer, ui };
}

function registerEveryEntry(icon?: ReactNode): PluginLocalContributions {
	const { contributions, fileExplorer, ui } = createApis("vetta-plugin://demo-plugin/assets/logo.png?v=1");
	ui.registerActivityTab({ id: "activity", label: "Activity", icon, component: () => null });
	ui.registerNewSessionContext({
		id: "context",
		label: "Context",
		icon,
		activateWhen: { skills: ["demo-skill"] },
		render: () => null,
	});
	ui.registerInputAction({ id: "action", label: "Action", icon, scope_use: ["project"] });
	ui.registerCardRenderer({ type: "demo-plugin:card", icon, component: () => null });
	fileExplorer.registerContextMenuAction({ id: "menu", label: "Menu", icon, run: () => {} });
	fileExplorer.registerToolbarAction({ id: "toolbar", label: "Toolbar", icon, run: () => {} });
	return contributions;
}

function entryIcons(contributions: PluginLocalContributions): ReactNode[] {
	return [
		contributions.activityTabs[0]?.icon,
		contributions.newSessionContexts[0]?.icon,
		contributions.inputActions[0]?.icon,
		contributions.cardRenderers[0]?.icon,
		contributions.fileExplorerContextMenuActions[0]?.icon,
		contributions.fileExplorerToolbarActions[0]?.icon,
	];
}

function expectImageIcon(icon: ReactNode, src: string): void {
	expect(isValidElement(icon)).toBe(true);
	const element = icon as ReactElement<{ src?: string }>;
	expect(element.type).toBe("img");
	expect(element.props.src).toBe(src);
}

describe("plugin contribution default icons", () => {
	it("inherits the plugin icon at every icon-bearing host entry", () => {
		const contributions = registerEveryEntry();
		for (const icon of entryIcons(contributions)) {
			expectImageIcon(icon, "vetta-plugin://demo-plugin/assets/logo.png?v=1");
		}
	});

	it("keeps each entry's explicit icon override", () => {
		const customIcon = createElement("span", { "data-icon": "custom" });
		const contributions = registerEveryEntry(customIcon);
		for (const icon of entryIcons(contributions)) {
			expect(icon).toBe(customIcon);
		}
	});

	it("keeps an explicit null instead of restoring the plugin icon", () => {
		const contributions = registerEveryEntry(null);
		for (const icon of entryIcons(contributions)) {
			expect(icon).toBeNull();
		}
	});

	it("turns an Iconify manifest icon into a renderable node", () => {
		const { contributions, ui } = createApis("solar:star-bold");
		ui.registerInputAction({ id: "action", label: "Action", scope_use: ["project"] });

		const icon = contributions.inputActions[0]?.icon;
		expect(isValidElement(icon)).toBe(true);
		const element = icon as ReactElement<{ className?: string }>;
		expect(element.type).toBe("span");
		expect(element.props.className).toContain("icon-[solar--star-bold]");
	});
});
