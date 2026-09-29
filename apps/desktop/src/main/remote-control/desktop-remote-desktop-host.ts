import { randomUUID } from "node:crypto";
import type { RemoteTransport } from "@vetta/remote-control";
import { decodeRemoteInputMessage } from "@vetta/remote-desktop";
import { BrowserWindow, desktopCapturer, ipcMain, session, webContents } from "electron";
import { getAppLogger } from "../logger.js";
import { registerRemoteDesktopVideoPermission } from "../speech-input/media-permissions.js";
import { resolveDesktopRemoteDesktopHostPaths } from "./desktop-remote-desktop-host-paths.js";
import { RendererDataChannelTransport } from "./renderer-data-channel-transport.js";
import { createSystemInputAdapter } from "./system-input.js";

export interface DesktopRemoteDesktopHostOptions {
	readonly signalingUrl?: string;
	readonly pairingToken?: string;
	readonly signalingTarget?: string;
	readonly inputEnabled: boolean;
	/**
	 * Capture only while a phone subscribes through `setScreen` (ADR-0140). Off for a
	 * phone that does not declare `screen`: it expects the screen for the whole session.
	 */
	readonly screenOnDemand?: boolean;
	readonly appRoot: string;
	readonly isPackaged: boolean;
	readonly devServerUrl?: string;
}

export interface DesktopRemoteDesktopHostHandle {
	readonly sessionId: string;
	readonly inputSupported: boolean;
	readonly controlTransport: RemoteTransport;
	/** Starts or stops capturing; resolves to whether frames now flow. A host sharing for the whole session always does. */
	setScreen(active: boolean): Promise<boolean>;
	/** Builds the input adapter again if it was unsupported, e.g. before Accessibility was granted. */
	refreshInput(): boolean;
	revokeInput(): void;
	grantInput(): void;
	stop(): Promise<void>;
}

const log = getAppLogger("remote-desktop-host");
/** Starting a capture shows no prompt here, so anything longer means it hung. */
const SCREEN_REQUEST_TIMEOUT_MS = 10_000;
let activeHost: DesktopRemoteDesktopHostHandle | undefined;

/** Starts the hidden renderer only when an explicit relay target is configured. */
export async function startDesktopRemoteDesktopHost(
	options: DesktopRemoteDesktopHostOptions,
): Promise<DesktopRemoteDesktopHostHandle> {
	if (activeHost) return activeHost;
	const sessionId =
		remoteDesktopSessionId(options.signalingTarget ?? options.signalingUrl ?? "") ?? `desktop-${randomUUID()}`;
	let inputEnabled = options.inputEnabled;
	let input = createSystemInputAdapter({ enabled: inputEnabled });
	input.setEnabled(inputEnabled);
	const paths = resolveDesktopRemoteDesktopHostPaths(options);
	const window = new BrowserWindow({
		show: false,
		width: 1280,
		height: 720,
		webPreferences: {
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			preload: paths.preloadPath,
		},
	});
	const unregisterVideoPermission = registerRemoteDesktopVideoPermission(window.webContents.id);
	const controlTransport = new RendererDataChannelTransport({
		send(message) {
			if (!window.isDestroyed()) window.webContents.send("vetta:remote-desktop:control-send", message);
		},
		close() {
			if (!window.isDestroyed()) window.webContents.send("vetta:remote-desktop:control-close");
		},
	});
	window.webContents.on("console-message", (_event, level, message) => {
		const fields = { sessionId, level };
		if (level >= 2) log.warn(`renderer: ${message}`, fields);
		else log.info(`renderer: ${message}`, fields);
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
	const onControlOpen = (event: Electron.IpcMainEvent): void => {
		if (event.sender.id === window.webContents.id) controlTransport.handleOpen();
	};
	const onControlMessage = (event: Electron.IpcMainEvent, message: unknown): void => {
		if (event.sender.id === window.webContents.id) controlTransport.handleMessage(message);
	};
	const onControlClose = (event: Electron.IpcMainEvent, reason?: string): void => {
		if (event.sender.id === window.webContents.id) {
			controlTransport.handleClose(typeof reason === "string" ? reason.slice(0, 256) : undefined);
		}
	};
	ipcMain.on("vetta:remote-desktop:control-open", onControlOpen);
	ipcMain.on("vetta:remote-desktop:control-message", onControlMessage);
	ipcMain.on("vetta:remote-desktop:control-close", onControlClose);
	// The page asks for the screen itself; it reloads when signaling drops, so it says when
	// it is listening and gets the screen again if a phone still wants it.
	let screenWanted = false;
	let screenReady = false;
	let screenRequests = 0;
	const screenWaiters = new Map<number, (streaming: boolean) => void>();
	const readyWaiters = new Set<() => void>();
	const requestScreen = (active: boolean): Promise<boolean> =>
		new Promise((resolve) => {
			if (window.isDestroyed()) {
				resolve(false);
				return;
			}
			const id = ++screenRequests;
			const timer = setTimeout(() => {
				screenWaiters.delete(id);
				log.warn("remote desktop screen request timed out", { sessionId, active });
				resolve(false);
			}, SCREEN_REQUEST_TIMEOUT_MS);
			screenWaiters.set(id, (streaming) => {
				clearTimeout(timer);
				resolve(streaming);
			});
			window.webContents.send("vetta:remote-desktop:screen", { id, active });
		});
	const onScreenReady = (event: Electron.IpcMainEvent): void => {
		if (event.sender.id !== window.webContents.id) return;
		screenReady = true;
		for (const waiter of readyWaiters) waiter();
		readyWaiters.clear();
		if (screenWanted) void requestScreen(true);
	};
	const onScreenResult = (event: Electron.IpcMainEvent, id: unknown, streaming: unknown): void => {
		if (event.sender.id !== window.webContents.id || typeof id !== "number") return;
		screenWaiters.get(id)?.(streaming === true);
		screenWaiters.delete(id);
	};
	const waitForScreenReady = (): Promise<boolean> =>
		screenReady
			? Promise.resolve(true)
			: new Promise((resolve) => {
					const done = (): void => {
						clearTimeout(timer);
						resolve(true);
					};
					const timer = setTimeout(() => {
						readyWaiters.delete(done);
						resolve(false);
					}, SCREEN_REQUEST_TIMEOUT_MS);
					readyWaiters.add(done);
				});
	ipcMain.on("vetta:remote-desktop:screen-ready", onScreenReady);
	ipcMain.on("vetta:remote-desktop:screen-result", onScreenResult);
	window.webContents.on("did-start-loading", () => {
		screenReady = false;
	});
	const removeControlListeners = (): void => {
		ipcMain.removeListener("vetta:remote-desktop:control-open", onControlOpen);
		ipcMain.removeListener("vetta:remote-desktop:control-message", onControlMessage);
		ipcMain.removeListener("vetta:remote-desktop:control-close", onControlClose);
		ipcMain.removeListener("vetta:remote-desktop:screen-ready", onScreenReady);
		ipcMain.removeListener("vetta:remote-desktop:screen-result", onScreenResult);
		for (const waiter of screenWaiters.values()) waiter(false);
		screenWaiters.clear();
	};
	let displayMediaHandlerInstalled = false;
	try {
		// Electron supplies the first physical display to getDisplayMedia in the
		// hidden renderer. No screen pixels or credentials pass through the relay.
		session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
			const requestingWebContents = request.frame ? webContents.fromFrame(request.frame) : undefined;
			if (requestingWebContents?.id !== window.webContents.id || !request.videoRequested || request.audioRequested) {
				log.warn("remote desktop display media request rejected", {
					sessionId,
					hasFrame: request.frame !== null,
					videoRequested: request.videoRequested,
					audioRequested: request.audioRequested,
				});
				callback({ video: undefined });
				return;
			}
			void desktopCapturer
				.getSources({ types: ["screen"] })
				.then((sources) => {
					const source = sources[0];
					if (source) {
						log.info("remote desktop screen capture granted", { sessionId, sourceCount: sources.length });
						callback({ video: source });
						return;
					}
					log.warn("remote desktop screen capture source unavailable", { sessionId });
					callback({ video: undefined });
				})
				.catch((error: unknown) => {
					log.warn("remote desktop screen capture enumeration failed", { sessionId, error });
					callback({ video: undefined });
				});
		});
		displayMediaHandlerInstalled = true;

		const target = options.signalingTarget ?? `${options.signalingUrl}#${options.pairingToken}`;
		const screen = options.screenOnDemand ? "demand" : "always";
		if (options.isPackaged) {
			await window.loadFile(paths.pagePath, {
				query: { target, sessionId, screen },
			});
		} else {
			const page = `${options.devServerUrl ?? "http://127.0.0.1:3020"}/remote-desktop-host.html`;
			await window.loadURL(
				`${page}?target=${encodeURIComponent(target)}&sessionId=${encodeURIComponent(sessionId)}&screen=${screen}`,
			);
		}
	} catch (error) {
		input.setEnabled(false);
		unregisterVideoPermission();
		ipcMain.removeListener("vetta:remote-desktop:input", onInput);
		removeControlListeners();
		if (displayMediaHandlerInstalled) session.defaultSession.setDisplayMediaRequestHandler(null);
		if (!window.isDestroyed()) window.destroy();
		throw error;
	}
	log.info("remote desktop host started", {
		sessionId,
		inputEnabled: input.supported,
		screenOnDemand: options.screenOnDemand === true,
	});

	const handle: DesktopRemoteDesktopHostHandle = {
		sessionId,
		get inputSupported() {
			return input.supported;
		},
		controlTransport,
		async setScreen(active) {
			if (!options.screenOnDemand) return true;
			screenWanted = active;
			if (!(await waitForScreenReady())) return false;
			// A later request may have changed what is wanted while this one waited.
			if (screenWanted !== active) return screenWanted;
			const streaming = await requestScreen(active);
			log.info("remote desktop screen subscription", { sessionId, active, streaming });
			return streaming;
		},
		refreshInput() {
			if (input.supported) return true;
			const next = createSystemInputAdapter({ enabled: inputEnabled });
			if (next.supported) {
				input = next;
				log.info("remote desktop input became available", { sessionId });
			}
			return input.supported;
		},
		revokeInput() {
			inputEnabled = false;
			input.setEnabled(false);
		},
		grantInput() {
			inputEnabled = true;
			input.setEnabled(true);
		},
		async stop() {
			input.setEnabled(false);
			unregisterVideoPermission();
			session.defaultSession.setDisplayMediaRequestHandler(null);
			ipcMain.removeListener("vetta:remote-desktop:input", onInput);
			removeControlListeners();
			await controlTransport.close("remote desktop host stopped");
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
	return /\/v2\/desktop\/([A-Za-z0-9_-]{16,128})\/host(?:#|$)/.exec(target)?.[1];
}
