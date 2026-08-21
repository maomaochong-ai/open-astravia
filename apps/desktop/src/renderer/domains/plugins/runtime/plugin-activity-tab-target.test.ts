// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	attachedPluginTabsAtom,
} from "@shared/store/atoms";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

const FOREGROUND_CWD = "C:\\work\\foreground";
const TOOL_SESSION_CWD = "C:\\work\\tool-session";

function installedPlugin(permissions: PluginPermission[]): InstalledPlugin {
	return {
		id: "demo-plugin",
		name: "Demo",
		permissions,
		grantedPermissions: permissions,
	} as unknown as InstalledPlugin;
}

function createUi() {
	return createPluginUiApi({
		plugin: installedPlugin(["ui.slot.activity-tab"]),
		contributions: new PluginLocalContributions(),
		onChanged: () => {},
		disposers: [],
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
}

describe("activity-tab command target cwd", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(activeSessionAtom, {
			cwd: FOREGROUND_CWD,
			runtimeId: "foreground-runtime",
			sessionPath: "C:\\sessions\\foreground.jsonl",
		});
		store.set(attachedPluginTabsAtom, new Map());
		store.set(activityPanelTabByProjectAtom, new Map());
		store.set(activityPanelOpenAtom, false);
	});

	it("writes attach and active-tab state to an explicit background session cwd", () => {
		const ui = createUi();

		ui.setActivityTabVisible("canvas", true, { cwd: TOOL_SESSION_CWD });
		ui.openActivityTab("canvas", { width: "max", cwd: TOOL_SESSION_CWD });

		const store = getDefaultStore();
		expect(store.get(attachedPluginTabsAtom).get(TOOL_SESSION_CWD)).toEqual(["demo-plugin:canvas"]);
		expect(store.get(attachedPluginTabsAtom).has(FOREGROUND_CWD)).toBe(false);
		expect(store.get(activityPanelTabByProjectAtom).get(TOOL_SESSION_CWD)).toBe("plugin:demo-plugin:canvas");
		expect(store.get(activityPanelTabByProjectAtom).has(FOREGROUND_CWD)).toBe(false);
		expect(store.get(activityPanelOpenAtom)).toBe(true);
	});

	it("preserves the current-conversation fallback for existing callers", () => {
		const ui = createUi();

		ui.openActivityTab("canvas");

		const store = getDefaultStore();
		expect(store.get(attachedPluginTabsAtom).get(FOREGROUND_CWD)).toEqual(["demo-plugin:canvas"]);
		expect(store.get(activityPanelTabByProjectAtom).get(FOREGROUND_CWD)).toBe("plugin:demo-plugin:canvas");
	});

	it("rejects a relative cwd instead of creating an unreachable persistence key", () => {
		const ui = createUi();
		expect(() => ui.openActivityTab("canvas", { cwd: "relative/project" })).toThrow(
			"Activity tab cwd must be an absolute path",
		);
	});
});
