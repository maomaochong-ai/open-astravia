/**
 * Desktop Electron batch-1 smoke: boot contract / config isolation / main-process mock probe.
 * Does not cover product UI. Requires dist/ artifacts, or release/*-unpacked when
 * VETTA_E2E_PACKAGED=1.
 */

const EXPECTED_CONFIG_DIR = process.env.VETTA_CONFIG_DIR ?? ".vetta-e2e";
const EXPECTED_VETTA_HOME = process.env.VETTA_HOME;

function normalizePath(p: string): string {
	return p.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

async function waitForRendererReady(): Promise<void> {
	await browser.waitUntil(
		async () => {
			const readyState = await browser.execute(() => document.readyState);
			return readyState === "complete" || readyState === "interactive";
		},
		{
			timeout: 60_000,
			timeoutMsg: "Renderer document did not become ready",
		},
	);
}

describe("Vetta Desktop smoke — boot contract", () => {
	it("main process is ready and has at least one live window", async () => {
		const snapshot = await browser.electron.execute((electron) => {
			const windows = electron.BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
			return {
				ready: electron.app.isReady(),
				name: electron.app.getName(),
				version: electron.app.getVersion(),
				windowCount: windows.length,
			};
		});

		expect(snapshot.ready).toBe(true);
		expect(snapshot.name.length).toBeGreaterThan(0);
		expect(snapshot.version.length).toBeGreaterThan(0);
		expect(snapshot.windowCount).toBeGreaterThanOrEqual(1);
	});

	it("main window loads the main renderer (index.html)", async () => {
		const readMainUrl = async (): Promise<string> =>
			browser.electron.execute((electron) => {
				const windows = electron.BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
				// Prefer a window that already loaded renderer/index.html when multiple exist.
				const preferred =
					windows.find((win) => {
						try {
							return win.webContents.getURL().includes("index.html");
						} catch {
							return false;
						}
					}) ?? windows[0];
				if (!preferred) return "";
				try {
					return preferred.webContents.getURL();
				} catch {
					return "";
				}
			});

		await browser.waitUntil(
			async () => {
				const mainUrl = await readMainUrl();
				if (mainUrl.includes("index.html")) return true;
				try {
					return (await browser.getUrl()).includes("index.html");
				} catch {
					return false;
				}
			},
			{
				timeout: 60_000,
				timeoutMsg: "Main window did not load renderer index.html",
			},
		);

		const mainUrl = await readMainUrl();
		const focusedUrl = await browser.getUrl();
		expect(mainUrl.includes("index.html") || focusedUrl.includes("index.html")).toBe(true);
	});

	it("renderer document is accessible", async () => {
		await waitForRendererReady();
		const body = await $("body");
		await expect(body).toExist();
	});
});

describe("Vetta Desktop smoke — config isolation", () => {
	it("E2E env vars are injected into the main process", async () => {
		const env = await browser.electron.execute(() => {
			return {
				vettaE2e: process.env.VETTA_E2E,
				configDir: process.env.VETTA_CONFIG_DIR,
				vettaHome: process.env.VETTA_HOME,
			};
		});

		expect(env.vettaE2e).toBe("1");
		expect(env.configDir).toBe(EXPECTED_CONFIG_DIR);
		expect(env.vettaHome).toBeTruthy();
		if (EXPECTED_VETTA_HOME) {
			expect(normalizePath(env.vettaHome ?? "")).toBe(normalizePath(EXPECTED_VETTA_HOME));
		} else {
			// Without an explicit override, home must still use the isolated config dir name.
			expect(normalizePath(env.vettaHome ?? "")).toContain(normalizePath(EXPECTED_CONFIG_DIR));
		}
	});

	it("Chromium userData uses the E2E isolation directory", async () => {
		const userData = await browser.electron.execute((electron) => electron.app.getPath("userData"));
		// wdio.conf isolates via --user-data-dir=.wdio-electron-user-data
		expect(normalizePath(userData)).toContain("wdio-electron-user-data");
	});
});

describe("Vetta Desktop smoke — main-process mock probe", () => {
	it("can mock dialog.showOpenDialog and intercept the call", async () => {
		const mockShowOpenDialog = await browser.electron.mock("dialog", "showOpenDialog");
		await mockShowOpenDialog.mockResolvedValue({
			canceled: true,
			filePaths: [],
		});

		const result = await browser.electron.execute(async (electron) => {
			return await electron.dialog.showOpenDialog({
				properties: ["openFile"],
			});
		});

		expect(result).toEqual({ canceled: true, filePaths: [] });
		expect(mockShowOpenDialog).toHaveBeenCalledTimes(1);
		expect(mockShowOpenDialog).toHaveBeenCalledWith({
			properties: ["openFile"],
		});
	});
});
