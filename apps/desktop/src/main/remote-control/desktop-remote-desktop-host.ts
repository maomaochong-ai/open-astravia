import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { decodeRemoteInputMessage } from "@vetta/remote-desktop";
import { BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import { getAppLogger } from "../logger.js";
import { createSystemInputAdapter } from "./system-input.js";

export interface DesktopRemoteDesktopHostOptions {
	readonly signalingUrl?: string;
	readonly pairingToken?: string;
	readonly signalingTarget?: string;
	readonly inputEnabled: boolean;
	readonly appRoot: string;
	readonly isPackaged: boolean;
	readonly devServerUrl?: string;
}

export interface DesktopRemoteDesktopHostHandle {
	readonly sessionId: string;
	readonly inputSupported: boolean;
	revokeInput(): void;
	grantInput(): void;
	stop(): Promise<void>;
}

const log = getAppLogger("remote-desktop-host");
let activeHost: DesktopRemoteDesktopHostHandle | undefined;

/** Starts the hidden renderer only when an explicit relay target is configured. */
export async function startDesktopRemoteDesktopHost(
	options: DesktopRemoteDesktopHostOptions,
): Promise<DesktopRemoteDesktopHostHandle> {
	if (activeHost) return activeHost;
	const sessionId =
		remoteDesktopSessionId(options.signalingTarget ?? options.signalingUrl ?? "") ?? `desktop-${randomUUID()}`;
	const input = createSystemInputAdapter({ enabled: options.inputEnabled });
	input.setEnabled(options.inputEnabled);
	const window = new BrowserWindow({
		show: false,
		width: 1280,
		height: 720,
		webPreferences: {
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			preload: join(options.appRoot, "dist/preload/remote-desktop.js"),
		},
	});
	const onInput = (_event: Electron.IpcMainEvent, message: unknown): void => {
		if (_event.sender.id !== window.webContents.id) return;
		try {
			input.apply(decodeRemoteInputMessage(message));
		} catch {
			log.warn("invalid remote desktop IPC input rejected", { sessionId });
		}
	};
	ipcMain.on("vetta:remote-desktop:input", onInput);

	// Electron supplies the first physical display to getDisplayMedia in the
	// hidden renderer. No screen pixels or credentials pass through the relay.
	session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
		if (!request.frame?.url.includes("remote-desktop-host.html")) {
			callback({ video: undefined });
			return;
		}
		void desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
			const source = sources[0];
			if (source) callback({ video: source });
			else callback({ video: undefined });
		});
	});

	const target = options.signalingTarget ?? `${options.signalingUrl}#${options.pairingToken}`;
	if (options.isPackaged) {
		await window.loadFile(join(options.appRoot, "dist/renderer/remote-desktop-host.html"), {
			query: { target, sessionId },
		});
	} else {
		const page = `${options.devServerUrl ?? "http://127.0.0.1:3020"}/remote-desktop-host.html`;
		await window.loadURL(`${page}?target=${encodeURIComponent(target)}&sessionId=${encodeURIComponent(sessionId)}`);
	}
	log.info("remote desktop host started", { sessionId, inputEnabled: input.supported });

	const handle: DesktopRemoteDesktopHostHandle = {
		sessionId,
		inputSupported: input.supported,
		revokeInput() {
			input.setEnabled(false);
		},
		grantInput() {
			input.setEnabled(true);
		},
		async stop() {
			input.setEnabled(false);
			session.defaultSession.setDisplayMediaRequestHandler(null);
			ipcMain.removeListener("vetta:remote-desktop:input", onInput);
			if (!window.isDestroyed()) window.destroy();
			activeHost = undefined;
			log.info("remote desktop host stopped", { sessionId });
		},
	};
	activeHost = handle;
	return handle;
}

export async function stopDesktopRemoteDesktopHost(): Promise<void> {
	await activeHost?.stop();
}

function remoteDesktopSessionId(target: string): string | undefined {
	return /\/v1\/desktop\/([A-Za-z0-9_-]{24,128})\/host(?:#|$)/.exec(target)?.[1];
}
