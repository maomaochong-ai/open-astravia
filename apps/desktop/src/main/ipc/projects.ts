import { ipcMain } from "electron";
import { getDesktopProjectService } from "../projects/project-service-instance.js";

const CHANNELS = {
	LIST: "vetta:projects:list",
	CREATE: "vetta:projects:create",
	OPEN: "vetta:projects:open",
	RENAME: "vetta:projects:rename",
	ARCHIVE: "vetta:projects:archive",
	UNARCHIVE: "vetta:projects:unarchive",
	REMOVE: "vetta:projects:remove",
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 项目增删改查的渲染进程入口。
 *
 * 渲染进程此前自己 `config.get()` → 改数组 → `config.set()`，与插件/Action 走的
 * ProjectService 形成两条并行写路径：校验（绝对路径、必须是目录）只有后者做，
 * 变更广播也只有后者发。这里把渲染进程接回同一个服务，写入只剩一条路径。
 */
export function registerProjectsIpc(): () => void {
	ipcMain.handle(CHANNELS.LIST, () => getDesktopProjectService().list());

	ipcMain.handle(CHANNELS.CREATE, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getDesktopProjectService().create(asString(raw.name), asOptionalString(raw.path));
	});

	ipcMain.handle(CHANNELS.OPEN, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getDesktopProjectService().open(asString(raw.path), asOptionalString(raw.name));
	});

	ipcMain.handle(CHANNELS.RENAME, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getDesktopProjectService().rename(asString(raw.path), asString(raw.name));
	});

	ipcMain.handle(CHANNELS.ARCHIVE, (_event, path: unknown) => getDesktopProjectService().archive(asString(path)));

	ipcMain.handle(CHANNELS.UNARCHIVE, (_event, path: unknown) => getDesktopProjectService().unarchive(asString(path)));

	ipcMain.handle(CHANNELS.REMOVE, (_event, path: unknown) => getDesktopProjectService().remove(asString(path)));

	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
