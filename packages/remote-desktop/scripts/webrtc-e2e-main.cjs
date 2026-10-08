const { app, BrowserWindow } = require("electron");
const { basename, join, resolve, sep } = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

const RESULT_PREFIX = "VETTA_E2E_RESULT:";
const profile = mkdtempSync(join(tmpdir(), "vetta-webrtc-e2e-"));
app.setPath("userData", profile);
app.on("quit", () => {
	if (!resolve(profile).startsWith(`${resolve(tmpdir())}${sep}`) || !basename(profile).startsWith("vetta-webrtc-e2e-")) return;
	try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium may retain handles until process exit. */ }
});
const timeout = setTimeout(() => finish({ ok: false, error: "Electron WebRTC E2E timed out" }), 40_000);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Match the Desktop host's version-scoped Windows configuration (ADR-0149).
if (process.platform === "win32" && process.versions.chrome?.split(".")[0] === "132") {
	app.commandLine.appendSwitch("disable-features", "KeepEncoderInstanceOnRelease");
}
// Expose hardware codec statistics using a synthetic camera; no physical device is accessed.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");

app.whenReady().then(async () => {
	const window = new BrowserWindow({
		show: false,
		width: 640,
		height: 480,
		webPreferences: {
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	window.webContents.on("page-title-updated", (event, title) => {
		if (!title.startsWith(RESULT_PREFIX)) return;
		event.preventDefault();
		finish(JSON.parse(title.slice(RESULT_PREFIX.length)));
	});
	window.webContents.on("render-process-gone", (_event, details) => {
		finish({ ok: false, error: `renderer exited: ${details.reason}` });
	});
	await window.loadFile(join(__dirname, "../e2e/webrtc-e2e.html"));
});

function finish(result) {
	clearTimeout(timeout);
	process.stdout.write(`${JSON.stringify(result)}\n`);
	app.exit(result.ok ? 0 : 1);
}
