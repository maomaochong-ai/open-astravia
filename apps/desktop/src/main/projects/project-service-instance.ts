import { stat } from "node:fs/promises";
import { parseProjectLocation } from "@vetta/ssh-transport";
import { readDesktopConfig, writeDesktopConfig } from "../config/desktop-config-store.js";
import { allowProjectRoot, createFilesystemDirectory } from "../filesystem/filesystem-service.js";
import { getSshConnection } from "../ssh/ssh-runtime.js";
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
		isKnownSshHost: async (hostId) => {
			const config = await readDesktopConfig();
			return (config.sshHosts ?? []).some((host) => host.id === hostId);
		},
		isExistingNonDirectory: async (path) => {
			const location = parseProjectLocation(path);
			if (location.kind === "ssh") {
				try {
					const entry = await getSshConnection(location.hostId).stat(location.remotePath);
					// 远端说「没有这个路径」时放行——与本地一致，open 允许登记还没建出来的目录。
					return entry !== null && entry.kind !== "directory";
				} catch {
					// 连不上不代表它不是目录。这里只做准入校验，判不了就别拦，
					// 真正的失败会在打开项目时带着连接错误浮出来（ADR-0124：不臆断问不到的事）。
					return false;
				}
			}
			// 直接查磁盘：这是「能不能登记成项目」的判断，此刻该路径还不在任何授权根里，
			// 走不了 filesystem-service 那套带 allowedRoots 断言的入口。
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
