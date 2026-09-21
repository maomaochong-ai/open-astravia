import type { SshConnectionStatus } from "@vetta/ssh-transport";
import { BrowserWindow } from "electron";
import { SSH_CHANNELS, type SshHostStatusEvent } from "../../shared/ssh-ipc.js";

function broadcast(channel: string, payload?: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
		win.webContents.send(channel, payload);
	}
}

export function broadcastSshHostsChanged(): void {
	broadcast(SSH_CHANNELS.HOSTS_CHANGED);
}

/**
 * 端口转发清单已变。
 *
 * 不带载荷：转发的状态会因巡检重建而自己变化，不只由渲染进程的操作驱动，让界面重读一次
 * 比在事件里塞增量更难出错。
 */
export function broadcastSshPortForwards(): void {
	broadcast(SSH_CHANNELS.PORT_FORWARDS_CHANGED);
}

export function broadcastSshHostStatus(hostId: string, status: SshConnectionStatus): void {
	broadcast(SSH_CHANNELS.HOST_STATUS, { hostId, status } satisfies SshHostStatusEvent);
}
