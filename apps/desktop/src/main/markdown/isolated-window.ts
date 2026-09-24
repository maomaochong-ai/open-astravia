import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { BrowserWindow } from "electron";

/** A separate ephemeral session prevents Chromium from sharing the host renderer process. */
export function createMarkdownWindow(owner: WebContents, visible: boolean): BrowserWindow {
	const window = new BrowserWindow({
		width: 960,
		height: 720,
		show: visible,
		parent: BrowserWindow.fromWebContents(owner) ?? undefined,
		webPreferences: {
			partition: `markdown-${randomUUID()}`,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			webviewTag: false,
			devTools: false,
			disableDialogs: true,
			backgroundThrottling: true,
		},
	});
	window.setMenu(null);
	const contents = window.webContents;
	contents.setWindowOpenHandler(() => ({ action: "deny" }));
	contents.on("will-navigate", (event) => event.preventDefault());
	contents.on("will-frame-navigate", (event) => event.preventDefault());
	contents.on("will-attach-webview", (event) => event.preventDefault());
	const session = contents.session;
	session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	session.setPermissionCheckHandler(() => false);
	session.on("will-download", (event) => event.preventDefault());
	session.webRequest.onBeforeRequest((details, callback) => {
		callback({ cancel: !/^(?:data:|about:)/.test(details.url) });
	});
	const close = () => terminateMarkdownWindow(window);
	owner.once("destroyed", close);
	window.once("closed", () => owner.removeListener("destroyed", close));
	return window;
}

export function terminateMarkdownWindow(window: BrowserWindow): void {
	if (window.isDestroyed()) return;
	// Runs in Main even when untrusted JavaScript monopolizes the child event loop.
	window.webContents.forcefullyCrashRenderer();
	window.destroy();
}

export function isolatedDocument(source: string): string {
	const policy =
		"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
	const document = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${source}`;
	return `data:text/html;charset=utf-8;base64,${Buffer.from(document, "utf8").toString("base64")}`;
}
