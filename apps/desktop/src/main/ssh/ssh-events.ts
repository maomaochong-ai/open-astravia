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

export function broadcastSshHostStatus(hostId: string, status: SshConnectionStatus): void {
	broadcast(SSH_CHANNELS.HOST_STATUS, { hostId, status } satisfies SshHostStatusEvent);
}
