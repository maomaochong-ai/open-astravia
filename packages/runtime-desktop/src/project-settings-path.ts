import { createHash } from "node:crypto";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@vetta/coding-agent/config";
import { isSshProjectUri, normalizeProjectCwd } from "@vetta/ssh-transport";

/**
 * 项目级 settings.json 的落点。
 *
 * 本地项目放在项目自己的 `.vetta/` 下。远程项目放在本机 agent 目录下按项目 URI 分片的
 * 影子目录里：设置存储是同步读写加文件锁，做不到跨网络；而直接 `join(cwd, …)` 会把 URI
 * 拼成相对路径 `ssh:/host/…`，一次写入就在进程 cwd 下建出一棵 `ssh:` 目录。
 *
 * 取舍：远端仓库里签入的 `.vetta/settings.json` 不会被读取，远程项目的项目级设置只存在
 * 于这台机器上。
 */
export function resolveProjectSettingsPath(cwd: string, agentDir: string): string {
	if (!isSshProjectUri(cwd)) return join(cwd, CONFIG_DIR_NAME, "settings.json");
	const key = createHash("sha256")
		.update(normalizeProjectCwd(cwd, (value) => value))
		.digest("hex")
		.slice(0, 24);
	return join(agentDir, "remote-projects", key, "settings.json");
}
