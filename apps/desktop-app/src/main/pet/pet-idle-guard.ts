import { powerMonitor } from "electron";
import { getAppLogger } from "../logger.js";
import { getPetWindow, sendPetCommandToWindow } from "../pet-window.js";

const log = getAppLogger("pet-idle-guard");

/**
 * 系统锁屏或休眠时暂停桌宠视频解码，解锁或唤醒后恢复。
 *
 * 无人使用桌面时无需继续解码与合成循环视频；暂停可降低后台 CPU 和 GPU 占用，
 * 但正常空闲状态不再干预播放。
 */
let started = false;
let paused = false;
let screenLocked = false;
let systemSuspended = false;

function setPlayback(playing: boolean): void {
	if (paused === !playing) return;
	// 无桌宠窗口时不必发（关闭/未启用），恢复播放时也无副作用。
	if (!getPetWindow()) return;
	paused = !playing;
	sendPetCommandToWindow({ type: "set-playback", playing });
	log.info(playing ? "resume" : "pause");
}

function syncPlayback(): void {
	setPlayback(!screenLocked && !systemSuspended);
}

/** 应用启动时调用一次：挂系统锁屏与休眠事件，据此暂停/恢复桌宠视频。 */
export function startPetIdleGuard(): void {
	if (started) return;
	started = true;
	powerMonitor.on("lock-screen", () => {
		screenLocked = true;
		syncPlayback();
	});
	powerMonitor.on("suspend", () => {
		systemSuspended = true;
		syncPlayback();
	});
	powerMonitor.on("unlock-screen", () => {
		screenLocked = false;
		syncPlayback();
	});
	powerMonitor.on("resume", () => {
		systemSuspended = false;
		syncPlayback();
	});
}
