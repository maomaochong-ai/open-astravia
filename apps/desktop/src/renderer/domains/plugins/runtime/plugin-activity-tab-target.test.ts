// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	attachedPluginTabsAtom,
	mountedActivityWorkspacesAtom,
} from "@shared/store/atoms";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function createUi(permissions: readonly string[] = ["ui.slot.activity-tab"]) {
	return createPluginUiApi({
		plugin: installedPlugin(permissions as never),
		contributions: new PluginLocalContributions(),
		onChanged: () => {},
		disposers: [],
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
}

describe("activity-tab command target cwd", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

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
		store.set(mountedActivityWorkspacesAtom, []);
	});

	it("writes attach and active-tab state to an explicit background session cwd", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const ui = createUi();

		ui.setActivityTabVisible("canvas", true, { cwd: TOOL_SESSION_CWD });
		ui.openActivityTab("canvas", { width: "max", cwd: TOOL_SESSION_CWD });

		const store = getDefaultStore();
		expect(store.get(attachedPluginTabsAtom).get(TOOL_SESSION_CWD)).toEqual(["demo-plugin:canvas"]);
		expect(store.get(attachedPluginTabsAtom).has(FOREGROUND_CWD)).toBe(false);
		expect(store.get(activityPanelTabByProjectAtom).get(TOOL_SESSION_CWD)).toBe("plugin:demo-plugin:canvas");
		expect(store.get(activityPanelTabByProjectAtom).has(FOREGROUND_CWD)).toBe(false);
		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(info).toHaveBeenCalledWith(
			'[activity-tab] opened {"pluginId":"demo-plugin","tabId":"canvas","alreadyAttached":true,"widthRequested":true}',
		);
		expect(info.mock.calls.flat().join(" ")).not.toContain(TOOL_SESSION_CWD);
	});

	it("preserves the current-conversation fallback for existing callers", () => {
		const ui = createUi();

		ui.openActivityTab("canvas");

		const store = getDefaultStore();
		expect(store.get(attachedPluginTabsAtom).get(FOREGROUND_CWD)).toEqual(["demo-plugin:canvas"]);
		expect(store.get(activityPanelTabByProjectAtom).get(FOREGROUND_CWD)).toBe("plugin:demo-plugin:canvas");
	});

	// A Team workspace keys panel state by its own workspace id, not by cwd (ADR-0105/0111).
	// Addressing the write by cwd would land on a key the Team panel never reads.
	it("writes to the workspace that owns the requested cwd", () => {
		const store = getDefaultStore();
		store.set(mountedActivityWorkspacesAtom, [{ id: "agent-team:ws-1", cwd: TOOL_SESSION_CWD }]);
		const ui = createUi();

		ui.setActivityTabVisible("canvas", true, { cwd: TOOL_SESSION_CWD });
		ui.openActivityTab("canvas", { width: "max", cwd: TOOL_SESSION_CWD });

		expect(store.get(attachedPluginTabsAtom).get("agent-team:ws-1")).toEqual(["demo-plugin:canvas"]);
		expect(store.get(attachedPluginTabsAtom).has(TOOL_SESSION_CWD)).toBe(false);
		expect(store.get(activityPanelTabByProjectAtom).get("agent-team:ws-1")).toBe("plugin:demo-plugin:canvas");
	});

	// Team never writes the active session, so a plugin that omits the cwd (activate-time
	// reveal) must still reach the workspace the user is actually looking at.
	it("falls back to the mounted workspace when no cwd is given", () => {
		const store = getDefaultStore();
		store.set(activeSessionAtom, null);
		store.set(mountedActivityWorkspacesAtom, [{ id: "agent-team:ws-1", cwd: TOOL_SESSION_CWD }]);
		const ui = createUi();

		ui.openActivityTab("canvas");

		expect(store.get(attachedPluginTabsAtom).get("agent-team:ws-1")).toEqual(["demo-plugin:canvas"]);
	});

	it("accepts a remote project cwd, since it identifies a workspace just like a local path", () => {
		const ui = createUi();
		expect(() => ui.setActivityTabVisible("canvas", false, { cwd: "ssh://host-1/srv/app" })).not.toThrow();
		expect(() => ui.openActivityTab("canvas", { cwd: "ssh://host-1/srv/app" })).not.toThrow();
	});

	it("previewFile accepts a file in a remote project", () => {
		// 媒体协议与目录监听都认得 `ssh://` 这个形态；在边界上拒掉只会让远端文件预览不了。
		const ui = createUi(["ui.slot.activity-tab", "fs.read"]);
		expect(() => ui.previewFile({ path: "ssh://host-1/srv/app/logo.png" })).not.toThrow();
		// 相对路径仍然要挡：渲染进程没有可靠的 base 去解析它。
		expect(() => ui.previewFile({ path: "relative/logo.png" })).toThrow(/requires an absolute path/);
	});

	it("rejects a relative cwd instead of creating an unreachable persistence key", () => {
		const ui = createUi();
		expect(() => ui.openActivityTab("canvas", { cwd: "relative/project" })).toThrow(
			"Activity tab cwd must be an absolute path",
		);
	});
});
