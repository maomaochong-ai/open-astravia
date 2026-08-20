// 应用菜单（mac 顶部菜单栏）。
//
// 之前本应用从不调用 Menu.setApplicationMenu，mac 上直接沿用 Electron 默认菜单，
// 于是打包版的 View 菜单自带 Reload / Force Reload / Toggle Developer Tools。
// DevTools 的风险见 devtools-policy.ts；Reload 则会打断正在进行的会话渲染，对终端
// 用户没有意义。这里接管菜单模板，把这两组开发期入口收进 isDevToolsAllowed() 门禁。
//
// mac 必须给出完整菜单（含 Edit role），不能直接 setApplicationMenu(null)：
// Cmd+C/V/A/Z 在 macOS 上由菜单 role 提供，没有菜单就整个失效。
// Windows/Linux 主窗口是 frameless（无菜单栏可见），关闭时直接置 null 即可，
// 复制粘贴由 Chromium 原生处理，不依赖菜单。

import { Menu, type MenuItemConstructorOptions } from "electron";
import { isDevToolsAllowed } from "./devtools-policy.js";
import { mainT } from "./i18n/index.js";

export interface ApplicationMenuTemplateOptions {
	isMac: boolean;
	/** 是否暴露 Reload / DevTools 等开发期入口。 */
	allowDevTools: boolean;
}

/** 返回 null 表示该平台此时不需要任何应用菜单。 */
export function buildApplicationMenuTemplate({
	isMac,
	allowDevTools,
}: ApplicationMenuTemplateOptions): MenuItemConstructorOptions[] | null {
	const developerItems: MenuItemConstructorOptions[] = allowDevTools
		? [
				{ role: "reload", label: mainT("menu.view.reload") },
				{ role: "forceReload", label: mainT("menu.view.forceReload") },
				{ role: "toggleDevTools", label: mainT("menu.view.toggleDevTools") },
			]
		: [];

	if (!isMac) {
		if (developerItems.length === 0) return null;
		return [{ label: mainT("menu.view.title"), submenu: developerItems }];
	}

	return [
		{
			role: "appMenu",
			label: mainT("menu.app.title"),
			submenu: [
				{ role: "about", label: mainT("menu.app.about") },
				{ type: "separator" },
				{ role: "services", label: mainT("menu.app.services") },
				{ type: "separator" },
				{ role: "hide", label: mainT("menu.app.hide") },
				{ role: "hideOthers", label: mainT("menu.app.hideOthers") },
				{ role: "unhide", label: mainT("menu.app.unhide") },
				{ type: "separator" },
				{ role: "quit", label: mainT("menu.app.quit") },
			],
		},
		{
			role: "editMenu",
			label: mainT("menu.edit.title"),
			submenu: [
				{ role: "undo", label: mainT("menu.edit.undo") },
				{ role: "redo", label: mainT("menu.edit.redo") },
				{ type: "separator" },
				{ role: "cut", label: mainT("menu.edit.cut") },
				{ role: "copy", label: mainT("menu.edit.copy") },
				{ role: "paste", label: mainT("menu.edit.paste") },
				{ role: "pasteAndMatchStyle", label: mainT("menu.edit.pasteAndMatchStyle") },
				{ role: "delete", label: mainT("menu.edit.delete") },
				{ role: "selectAll", label: mainT("menu.edit.selectAll") },
			],
		},
		{
			role: "viewMenu",
			label: mainT("menu.view.title"),
			submenu: [
				...developerItems,
				...(developerItems.length > 0 ? ([{ type: "separator" }] as MenuItemConstructorOptions[]) : []),
				{ role: "resetZoom", label: mainT("menu.view.resetZoom") },
				{ role: "zoomIn", label: mainT("menu.view.zoomIn") },
				{ role: "zoomOut", label: mainT("menu.view.zoomOut") },
				{ type: "separator" },
				{ role: "togglefullscreen", label: mainT("menu.view.toggleFullScreen") },
			],
		},
		{
			role: "windowMenu",
			label: mainT("menu.window.title"),
			submenu: [
				{ role: "minimize", label: mainT("menu.window.minimize") },
				{ role: "zoom", label: mainT("menu.window.zoom") },
				{ type: "separator" },
				{ role: "front", label: mainT("menu.window.front") },
				{ role: "close", label: mainT("menu.window.close") },
			],
		},
	];
}

/** 装配应用菜单。语言切换后需重新调用（菜单文案在构建期解析）。 */
export function installApplicationMenu(): void {
	const template = buildApplicationMenuTemplate({
		isMac: process.platform === "darwin",
		allowDevTools: isDevToolsAllowed(),
	});
	Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
}
