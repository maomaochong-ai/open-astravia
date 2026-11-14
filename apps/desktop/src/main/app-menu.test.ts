import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
	app: { isPackaged: true },
}));

// 缩放走主进程持久化比例，不碰 Chromium；菜单测试只关心快捷键接到了同一个入口。
vi.mock("./ui-zoom/ui-zoom-service.js", () => ({ resetUiZoom: vi.fn(), stepUiZoom: vi.fn() }));

import type { MenuItemConstructorOptions } from "electron";
import { buildApplicationMenuTemplate } from "./app-menu";

function collectRoles(template: MenuItemConstructorOptions[] | null): string[] {
	if (!template) return [];
	const roles: string[] = [];
	for (const item of template) {
		if (Array.isArray(item.submenu)) roles.push(...collectRoles(item.submenu));
		else if (item.role) roles.push(item.role);
	}
	return roles;
}

describe("application menu template", () => {
	// 打包版把 DevTools 暴露给终端用户即 self-XSS 面：控制台可直接驱动 preload IPC。
	it("omits devtools and reload on macOS when devtools are not allowed", () => {
		const roles = collectRoles(buildApplicationMenuTemplate({ isMac: true, allowDevTools: false }));

		expect(roles).not.toContain("toggleDevTools");
		expect(roles).not.toContain("reload");
		expect(roles).not.toContain("forceReload");
	});

	// mac 的 Cmd+C/V/A/Z 由 Edit role 提供，菜单收敛后仍必须保留，否则复制粘贴全废。
	it("keeps macOS edit roles so clipboard shortcuts still work", () => {
		const roles = collectRoles(buildApplicationMenuTemplate({ isMac: true, allowDevTools: false }));

		expect(roles).toEqual(expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll", "quit"]));
	});

	it("exposes devtools and reload on macOS when devtools are allowed", () => {
		const roles = collectRoles(buildApplicationMenuTemplate({ isMac: true, allowDevTools: true }));

		expect(roles).toEqual(expect.arrayContaining(["reload", "forceReload", "toggleDevTools"]));
	});

	// 非 mac 主窗口是 frameless，没有菜单栏；菜单只用于承载开发期快捷键。
	it("installs no menu at all on non-mac when devtools are not allowed", () => {
		expect(buildApplicationMenuTemplate({ isMac: false, allowDevTools: false })).toBeNull();
	});

	// role 版缩放直接改 Chromium，不经持久化比例，会和外观页各改各的。
	it("缩放快捷键走自定义项而不是 zoom role，且同时支持 Cmd+= 与 Cmd+Plus", () => {
		const template = buildApplicationMenuTemplate({ isMac: true, allowDevTools: false }) ?? [];
		const roles = collectRoles(template);
		expect(roles).not.toContain("zoomIn");
		expect(roles).not.toContain("zoomOut");
		expect(roles).not.toContain("resetZoom");

		const accelerators: string[] = [];
		const walk = (items: MenuItemConstructorOptions[]) => {
			for (const item of items) {
				if (Array.isArray(item.submenu)) walk(item.submenu);
				else if (typeof item.accelerator === "string") accelerators.push(item.accelerator);
			}
		};
		walk(template);
		expect(accelerators).toEqual(
			expect.arrayContaining([
				"CommandOrControl+0",
				"CommandOrControl+Plus",
				"CommandOrControl+=",
				"CommandOrControl+-",
			]),
		);
	});

	it("keeps a devtools-only menu on non-mac during development", () => {
		const roles = collectRoles(buildApplicationMenuTemplate({ isMac: false, allowDevTools: true }));

		expect(roles).toEqual(["reload", "forceReload", "toggleDevTools"]);
	});
});
