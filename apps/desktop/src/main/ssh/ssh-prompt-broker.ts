import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import {
	SSH_PROMPT_CHANNELS,
	type SshPromptRequestEvent,
	type SshPromptResponse,
} from "../../shared/ssh-prompt-ipc.js";
import type { SshPromptUserAnswer, SshPromptUserRequest } from "./ssh-prompt-service.js";

/** 一次提示最多等多久。超过就当用户没在看，让 ssh 放弃本次认证而不是无限挂着。 */
const PROMPT_TIMEOUT_MS = 3 * 60 * 1000;

interface PendingPrompt {
	resolve: (answer: SshPromptUserAnswer) => void;
	timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingPrompt>();
let registered = false;

/**
 * 把提示送到渲染进程并等用户回答。
 *
 * 超时和窗口全关都按「拒绝」处理：确认类提示绝不能因为没人应答就变成默认同意。
 */
export function askSshPromptInRenderer(request: SshPromptUserRequest): Promise<SshPromptUserAnswer> {
	ensureRegistered();
	const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed());
	if (windows.length === 0) return Promise.resolve({ ok: false });

	const id = randomUUID();
	const event: SshPromptRequestEvent = {
		id,
		hostId: request.hostId,
		hostLabel: request.hostLabel,
		kind: request.kind,
		prompt: request.prompt,
		rememberable: request.rememberable,
	};

	return new Promise<SshPromptUserAnswer>((resolve) => {
		const settle = (answer: SshPromptUserAnswer): void => {
			const entry = pending.get(id);
			if (!entry) return;
			pending.delete(id);
			clearTimeout(entry.timer);
			for (const win of BrowserWindow.getAllWindows()) {
				if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
				win.webContents.send(SSH_PROMPT_CHANNELS.CANCEL, id);
			}
			resolve(answer);
		};
		const timer = setTimeout(() => settle({ ok: false }), PROMPT_TIMEOUT_MS);
		timer.unref?.();
		pending.set(id, { resolve: settle, timer });
		// 广播给所有窗口：用户可能正看着快捷面板而不是主窗口。先答的那个算数。
		for (const win of windows) win.webContents.send(SSH_PROMPT_CHANNELS.REQUEST, event);
	});
}

function ensureRegistered(): void {
	if (registered) return;
	registered = true;
	ipcMain.on(SSH_PROMPT_CHANNELS.RESPOND, (_event, payload: unknown) => {
		const response = payload as Partial<SshPromptResponse> | undefined;
		if (!response || typeof response.id !== "string") return;
		const entry = pending.get(response.id);
		if (!entry) return;
		entry.resolve({
			ok: response.ok === true,
			...(typeof response.value === "string" ? { value: response.value } : {}),
			...(response.remember === true ? { remember: true } : {}),
		});
	});
}
