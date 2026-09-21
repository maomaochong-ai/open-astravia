import { ipcMain, type WebContents } from "electron";
import {
	clampTerminalSize,
	type OpenTerminalRequest,
	type OpenTerminalResult,
	TERMINAL_CHANNELS,
	type TerminalCapabilities,
} from "../../shared/terminal-ipc.js";
import { TerminalSnapshotStore } from "../terminal/snapshot-store.js";
import { TerminalService } from "../terminal/terminal-service.js";

/**
 * 终端 IPC：只做参数校验与转发，会话表、缓冲、忙闲状态都在 `main/terminal/`。
 *
 * 输出走单一 EVENT 频道多路复用，订阅在 open 时随 webContents 一起建立——
 * 渲染进程崩溃或导航时收不到 close，只能靠 webContents 的生命周期兜底回收 PTY。
 */

let service: TerminalService | undefined;
let snapshots: TerminalSnapshotStore | undefined;

function snapshotStore(): TerminalSnapshotStore {
	if (!snapshots) snapshots = new TerminalSnapshotStore();
	return snapshots;
}

function terminalService(): TerminalService {
	if (!service) service = new TerminalService();
	return service;
}

/** 仅供测试注入 fake service。 */
export function setTerminalServiceForTests(next: TerminalService | undefined): void {
	service = next;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`terminal: ${field} must be a non-empty string`);
	}
	return value;
}

function parseOpenRequest(value: unknown): OpenTerminalRequest {
	if (typeof value !== "object" || value === null) throw new Error("terminal: open request must be an object");
	const input = value as Record<string, unknown>;
	const cwd = requireString(input.cwd, "cwd");
	const size = clampTerminalSize(Number(input.cols), Number(input.rows));
	return { cwd, cols: size.cols, rows: size.rows };
}

/** 单次 write 的上限：正常输入远小于此，超大载荷只可能是坏调用。 */
const MAX_WRITE_LENGTH = 1024 * 1024;

/** 快照上报的上限；主进程还会再按字节截断一次。 */
const MAX_SNAPSHOT_LENGTH = 4 * 1024 * 1024;

function attachSubscription(sender: WebContents, terminalId: string): void {
	const session = terminalService().get(terminalId);
	if (!session) return;
	const unsubscribe = session.subscribe((event) => {
		if (sender.isDestroyed()) return;
		sender.send(TERMINAL_CHANNELS.EVENT, { terminalId, event });
	});
	// 会话随 owner 一起回收；这里只解绑事件转发，避免往已销毁的帧里灌数据。
	sender.once("destroyed", unsubscribe);
	sender.once("did-navigate", unsubscribe);
}

export function registerTerminalIpc(): () => void {
	const ownedWebContents = new Set<WebContents>();

	const trackOwner = (sender: WebContents): void => {
		if (ownedWebContents.has(sender)) return;
		ownedWebContents.add(sender);
		const release = (): void => {
			ownedWebContents.delete(sender);
			terminalService().disposeOwnedBy(sender.id);
		};
		sender.once("destroyed", release);
		sender.once("did-navigate", release);
	};

	ipcMain.handle(TERMINAL_CHANNELS.CAPABILITIES, (): TerminalCapabilities => terminalService().capabilities());

	ipcMain.handle(TERMINAL_CHANNELS.OPEN, async (event, request: unknown): Promise<OpenTerminalResult> => {
		const parsed = parseOpenRequest(request);
		trackOwner(event.sender);
		const result = await terminalService().open(event.sender.id, parsed);
		attachSubscription(event.sender, result.terminalId);
		return result;
	});

	ipcMain.handle(TERMINAL_CHANNELS.WRITE, (_event, terminalId: unknown, data: unknown) => {
		const id = requireString(terminalId, "terminalId");
		if (typeof data !== "string") throw new Error("terminal: data must be a string");
		if (data.length > MAX_WRITE_LENGTH) throw new Error("terminal: data too large");
		terminalService().get(id)?.write(data);
	});

	ipcMain.handle(TERMINAL_CHANNELS.RESIZE, (_event, terminalId: unknown, cols: unknown, rows: unknown) => {
		const id = requireString(terminalId, "terminalId");
		const size = clampTerminalSize(Number(cols), Number(rows));
		terminalService().get(id)?.resize(size.cols, size.rows);
	});

	ipcMain.handle(TERMINAL_CHANNELS.FOREGROUND, (_event, terminalId: unknown): string | null => {
		const id = requireString(terminalId, "terminalId");
		return terminalService().get(id)?.foregroundProcess() ?? null;
	});

	ipcMain.handle(TERMINAL_CHANNELS.CLOSE, (_event, terminalId: unknown) => {
		terminalService().dispose(requireString(terminalId, "terminalId"));
	});

	ipcMain.handle(TERMINAL_CHANNELS.SNAPSHOT_SAVE, async (_event, tabId: unknown, text: unknown) => {
		const id = requireString(tabId, "tabId");
		if (typeof text !== "string") throw new Error("terminal: snapshot text must be a string");
		// 上报过大就截断而不是报错：快照是尽力而为的东西，丢一部分好过丢整份。
		await snapshotStore().save(id, text.slice(-MAX_SNAPSHOT_LENGTH));
	});

	ipcMain.handle(TERMINAL_CHANNELS.SNAPSHOT_LOAD, async (_event, tabId: unknown): Promise<string | null> => {
		const id = requireString(tabId, "tabId");
		return (await snapshotStore().load(id)) ?? null;
	});

	return () => {
		for (const channel of Object.values(TERMINAL_CHANNELS)) {
			if (channel === TERMINAL_CHANNELS.EVENT) continue;
			ipcMain.removeHandler(channel);
		}
		ownedWebContents.clear();
		terminalService().disposeAll();
	};
}
