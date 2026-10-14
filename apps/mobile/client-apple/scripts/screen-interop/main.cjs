const { app, BrowserWindow } = require("electron");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const directory = process.argv[2];
if (!directory) throw new Error("Expected an isolated fixture directory");
app.setPath("userData", join(directory, "electron-profile"));
app.whenReady().then(async () => {
	const { port } = JSON.parse(readFileSync(join(directory, "info.json"), "utf8"));
	const window = new BrowserWindow({
		show: false,
		width: 640,
		height: 360,
		webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
	});
	await window.loadURL(`http://127.0.0.1:${port}/`);
});
