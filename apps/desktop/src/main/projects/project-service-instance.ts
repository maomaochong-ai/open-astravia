import { stat } from "node:fs/promises";
import { readDesktopConfig, writeDesktopConfig } from "../config/desktop-config-store.js";
import { allowProjectRoot, createFilesystemDirectory } from "../filesystem/filesystem-service.js";
import { broadcastProjectsChanged } from "./project-events.js";
import { ProjectService } from "./project-service.js";

let desktopProjectService: ProjectService | undefined;

/**
 * 进程内唯一的 {@link ProjectService}。
 *
 * 单例而非每个调用方各建一个：项目列表的写入必须串行经过同一个 `commit`，否则 IPC、
 * Capability 和 Action 三个入口会各自「读配置 → 改内存副本 → 整份写回」，后写的一方
 * 直接覆盖掉前一方刚加的项目。
 *
 * 装配留在本模块而不是 {@link ProjectService} 所在文件：那里的类保持纯依赖注入，
 * 单元测试才不用连带加载 electron（`broadcastProjectsChanged` 依赖 `BrowserWindow`）。
 */
export function getDesktopProjectService(): ProjectService {
	desktopProjectService ??= new ProjectService({
		allowProjectRoot,
		createDirectory: createFilesystemDirectory,
		readConfig: readDesktopConfig,
		writeConfig: writeDesktopConfig,
		broadcastChanged: broadcastProjectsChanged,
		// 直接查磁盘：这是「能不能登记成项目」的判断，此刻该路径还不在任何授权根里，
		// 走不了 filesystem-service 那套带 allowedRoots 断言的入口。
		isExistingNonDirectory: async (path) => {
			try {
				return !(await stat(path)).isDirectory();
			} catch {
				// 不存在（或读不到）不算「非目录」：open 本来就允许登记一个还没建出来的目录。
				return false;
			}
		},
	});
	return desktopProjectService;
}
