const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");

const RESULT_PREFIX = "VETTA_E2E_RESULT:";
const timeout = setTimeout(() => finish({ ok: false, error: "Electron WebRTC E2E timed out" }), 20_000);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

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
