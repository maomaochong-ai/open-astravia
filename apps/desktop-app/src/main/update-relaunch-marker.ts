import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 「本次启动是安装器重启的」标记。
 *
 * ShipIt 以 launchd 守护进程身份（作业里 `spawn type = daemon`）拉起应用，
 * 应用因此不会成为活动应用：窗口 `show()` 调了、renderer 也画完了，但
 * `show` 事件不触发、窗口不露面——用户看到的就是「点了重启，应用没回来」，
 * 而实际上进程在跑、版本也已经换好了。
 *
 * 手动启动没有这个问题（macOS 会正常激活应用），所以不能无条件抢焦点：那会让
 * 开机自启等场景平白打断用户。改为退出前打标记、启动时消费一次。
 */
const MARKER_FILE_NAME = ".pending-update-relaunch";

export function markPendingUpdateRelaunch(stateDir: string): void {
	try {
		writeFileSync(join(stateDir, MARKER_FILE_NAME), new Date().toISOString());
	} catch {
		// 标记只影响「窗口是否自动到前台」，写不进去不该阻断更新安装
	}
}

/** 存在即消费：返回本次启动是否由安装器重启触发。 */
export function consumePendingUpdateRelaunch(stateDir: string): boolean {
	const markerPath = join(stateDir, MARKER_FILE_NAME);
	try {
		if (!existsSync(markerPath)) return false;
		rmSync(markerPath, { force: true });
		return true;
	} catch {
		return false;
	}
}
