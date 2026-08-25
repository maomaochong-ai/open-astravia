// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

const PERMISSIONS: PluginPermission[] = ["ui.slot.workspace-view"];

function createUi(iconUrl?: string) {
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
	return { contributions, ui };
}

function registeredIcon(contributions: PluginLocalContributions): string | undefined {
	return contributions.workspaceViews[0]?.icon;
}

function registeredIconUrl(contributions: PluginLocalContributions): string | undefined {
	return (contributions.workspaceViews[0] as { iconUrl?: string } | undefined)?.iconUrl;
}

function maskRuleFor(className: string): string | undefined {
	return [...document.head.querySelectorAll("style[data-vetta-plugin-nav-icon]")]
		.map((style) => style.textContent ?? "")
		.find((text) => text.includes(className));
}

describe("workspace view navigation icon", () => {
	it("keeps an explicitly declared Iconify class as-is", () => {
		const { contributions, ui } = createUi("vetta-plugin://demo-plugin/assets/logo.svg?v=1");
		ui.registerWorkspaceView({
			id: "board",
			label: "Board",
			icon: "icon-[solar--crown-line-linear]",
			component: () => null,
		});
		expect(registeredIcon(contributions)).toBe("icon-[solar--crown-line-linear]");
	});

	it("falls back to the plugin's own packaged logo, masked so it follows the theme color", () => {
		const { contributions, ui } = createUi("vetta-plugin://demo-plugin/assets/logo.svg?v=1");
		const handle = ui.registerWorkspaceView({ id: "board", label: "Board", component: () => null });

		const icon = registeredIcon(contributions);
		expect(icon).toMatch(/^vetta-plugin-nav-icon-\d+$/);
		const rule = maskRuleFor(icon as string);
		expect(rule).toContain('mask-image:url("vetta-plugin://demo-plugin/assets/logo.svg?v=1")');
		expect(rule).toContain("background-color:currentColor");

		// The generated rule must go away with the contribution.
		handle.dispose();
		expect(maskRuleFor(icon as string)).toBeUndefined();
	});

	it("falls back to an Iconify manifest icon as a class, without injecting any rule", () => {
		const { contributions, ui } = createUi("solar:crown-bold");
		ui.registerWorkspaceView({ id: "board", label: "Board", component: () => null });
		const icon = registeredIcon(contributions);
		expect(icon).toBe("icon-[solar--crown-bold]");
		expect(maskRuleFor("vetta-plugin-nav-icon")).toBeUndefined();
	});

	it("leaves the icon unset when the plugin declares no logo at all", () => {
		const { contributions, ui } = createUi(undefined);
		ui.registerWorkspaceView({ id: "board", label: "Board", component: () => null });
		expect(registeredIcon(contributions)).toBeUndefined();
	});

	it("keeps a packaged logo tinted by default, exposing no image url", () => {
		const { contributions, ui } = createUi("vetta-plugin://demo-plugin/assets/logo.svg?v=1");
		ui.registerWorkspaceView({ id: "board", label: "Board", component: () => null });
		expect(registeredIcon(contributions)).toMatch(/^vetta-plugin-nav-icon-\d+$/);
		expect(registeredIconUrl(contributions)).toBeUndefined();
	});

	it("iconTint:false keeps the logo in full color and still ships a mask fallback", () => {
		const { contributions, ui } = createUi("vetta-plugin://demo-plugin/assets/logo.png?v=1");
		ui.registerWorkspaceView({ id: "board", label: "Board", iconTint: false, component: () => null });
		expect(registeredIconUrl(contributions)).toBe("vetta-plugin://demo-plugin/assets/logo.png?v=1");
		// Themes that do not know `iconUrl` still get a renderable class.
		expect(registeredIcon(contributions)).toMatch(/^vetta-plugin-nav-icon-\d+$/);
	});

	it("iconTint:false does not turn an Iconify class into an image", () => {
		const { contributions, ui } = createUi("vetta-plugin://p/logo.svg");
		ui.registerWorkspaceView({
			id: "board",
			label: "Board",
			icon: "icon-[solar--crown-linear]",
			iconTint: false,
			component: () => null,
		});
		expect(registeredIcon(contributions)).toBe("icon-[solar--crown-linear]");
		expect(registeredIconUrl(contributions)).toBeUndefined();
	});
});
