import type { HostSettingsPort } from "../contracts/host-settings.js";
import type { SettingsStatePort } from "../runtime/settings-state.js";

export function createHostSettingsView(state: SettingsStatePort): HostSettingsPort {
	return {
		getLastChangelogVersion: () => state.read().lastChangelogVersion,
		setLastChangelogVersion: (lastChangelogVersion) => state.patchGlobal({ lastChangelogVersion }),
		getShellPath: () => state.read().shellPath,
		setShellPath: (shellPath) => state.patchGlobal({ shellPath }),
		getQuietStartup: () => state.read().quietStartup ?? false,
		setQuietStartup: (quietStartup) => state.patchGlobal({ quietStartup }),
		getShellCommandPrefix: () => state.read().shellCommandPrefix,
		setShellCommandPrefix: (shellCommandPrefix) => state.patchGlobal({ shellCommandPrefix }),
		getCollapseChangelog: () => state.read().collapseChangelog ?? false,
		setCollapseChangelog: (collapseChangelog) => state.patchGlobal({ collapseChangelog }),
		getShowImages: () => state.read().terminal?.showImages ?? true,
		setShowImages: (showImages) => state.patchGlobal({ terminal: { showImages } }),
		getClearOnShrink: () => state.read().terminal?.clearOnShrink ?? process.env.PI_CLEAR_ON_SHRINK === "1",
		setClearOnShrink: (clearOnShrink) => state.patchGlobal({ terminal: { clearOnShrink } }),
		getDoubleEscapeAction: () => state.read().doubleEscapeAction ?? "tree",
		setDoubleEscapeAction: (doubleEscapeAction) => state.patchGlobal({ doubleEscapeAction }),
		getShowHardwareCursor: () => state.read().showHardwareCursor ?? process.env.PI_HARDWARE_CURSOR === "1",
		setShowHardwareCursor: (showHardwareCursor) => state.patchGlobal({ showHardwareCursor }),
		getEditorPaddingX: () => state.read().editorPaddingX ?? 0,
		setEditorPaddingX: (editorPaddingX) =>
			state.patchGlobal({ editorPaddingX: Math.max(0, Math.min(3, Math.floor(editorPaddingX))) }),
		getAutocompleteMaxVisible: () => state.read().autocompleteMaxVisible ?? 5,
		setAutocompleteMaxVisible: (autocompleteMaxVisible) =>
			state.patchGlobal({
				autocompleteMaxVisible: Math.max(3, Math.min(20, Math.floor(autocompleteMaxVisible))),
			}),
		getCodeBlockIndent: () => state.read().markdown?.codeBlockIndent ?? "  ",
		getEnableMcp: () => state.read().enableMcp ?? true,
		setEnableMcp: (enableMcp) => state.patchGlobal({ enableMcp }),
		getMcpDebug: () => state.read().mcpDebug ?? false,
		setMcpDebug: (mcpDebug) => state.patchGlobal({ mcpDebug }),
		getServerUrl: () => state.read().serverUrl,
		setServerUrl: (serverUrl) => state.patchGlobal({ serverUrl }),
		getServerToken: () => state.read().serverToken,
		getServerTokenFresh: () => state.readFreshGlobal("serverToken"),
		setServerToken: (serverToken) => state.patchGlobal({ serverToken }),
	};
}
