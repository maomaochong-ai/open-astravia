const packaged = process.env.VETTA_E2E_PACKAGED === "1";

describe("Vetta Desktop packaged resources", () => {
	(packaged ? it : it.skip)("loads the remote desktop host entry from the packaged layout", async () => {
		const result = await browser.electron.execute(async (electron) => {
			const appRoot = electron.app.getAppPath();
			const host = new electron.BrowserWindow({
				show: false,
				webPreferences: {
					contextIsolation: true,
					nodeIntegration: false,
					preload: `${appRoot}/preload/remote-desktop.js`,
				},
			});
			try {
				await host.loadFile(`${appRoot}/renderer/remote-desktop-host.html`, {
					query: {
						target: "ws://127.0.0.1:1/v1/desktop/packaged-smoke/host#pairing=invalid",
						sessionId: "packaged-smoke",
					},
				});
				return {
					url: host.webContents.getURL(),
					appRoot,
				};
			} finally {
				if (!host.isDestroyed()) host.destroy();
			}
		});

		expect(result.url).toContain("remote-desktop-host.html");
		expect(result.appRoot).toContain("app.asar");
	});
});
