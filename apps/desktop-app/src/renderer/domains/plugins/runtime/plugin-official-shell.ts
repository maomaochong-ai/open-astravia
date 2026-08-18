import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

/**
 * 在系统文件管理器里定位一个路径。
 *
 * 与 `ui.openExternal` 分开：那个入口只放行 http/https，刻意不让插件用它拉起任意
 * 协议（含 `file://`）。这里是官方来源专用的窄口子，只做「显示这个路径」一件事。
 */
export function createOfficialShellApi(assertOfficial: () => void): PluginOfficialApi["shell"] {
	return {
		showItemInFolder: async (path) => {
			assertOfficial();
			if (typeof path !== "string" || path.trim().length === 0) {
				throw new Error("official.shell.showItemInFolder: path is required");
			}
			await window.vetta.shell.showItemInFolder(path);
		},
	};
}
