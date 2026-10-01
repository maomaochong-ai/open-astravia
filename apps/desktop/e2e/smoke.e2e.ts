/**
 * Desktop Electron batch-1 smoke: boot contract / config isolation / main-process mock probe.
 * Does not cover product UI. Requires dist/ artifacts, or release/*-unpacked when
 * ASTRAVIA_E2E_PACKAGED=1.
 */

const EXPECTED_CONFIG_DIR = process.env.ASTRAVIA_CONFIG_DIR ?? ".astravia-e2e";
const EXPECTED_ASTRAVIA_HOME = process.env.ASTRAVIA_HOME;

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

describe("Astravia Desktop smoke — boot contract", () => {
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

describe("Astravia Desktop smoke — config isolation", () => {
	it("E2E env vars are injected into the main process", async () => {
		const env = await browser.electron.execute(() => {
			return {
				astraviaE2e: process.env.ASTRAVIA_E2E,
				configDir: process.env.ASTRAVIA_CONFIG_DIR,
				astraviaHome: process.env.ASTRAVIA_HOME,
			};
		});

		expect(env.astraviaE2e).toBe("1");
		expect(env.configDir).toBe(EXPECTED_CONFIG_DIR);
		expect(env.astraviaHome).toBeTruthy();
		if (EXPECTED_ASTRAVIA_HOME) {
			expect(normalizePath(env.astraviaHome ?? "")).toBe(normalizePath(EXPECTED_ASTRAVIA_HOME));
		} else {
			// Without an explicit override, home must still use the isolated config dir name.
			expect(normalizePath(env.astraviaHome ?? "")).toContain(normalizePath(EXPECTED_CONFIG_DIR));
		}
	});

	it("Chromium userData uses the E2E isolation directory", async () => {
		const userData = await browser.electron.execute((electron) => electron.app.getPath("userData"));
		// wdio.conf isolates via --user-data-dir=.wdio-electron-user-data
		expect(normalizePath(userData)).toContain("wdio-electron-user-data");
	});
});

describe("Astravia Desktop smoke — main-process mock probe", () => {
	it("can mock dialog.showOpenDialogSync and intercept the call", async () => {
		const mockShowOpenDialog = await browser.electron.mock("dialog", "showOpenDialogSync");
		await mockShowOpenDialog.mockReturnValue(["astravia-e2e-selection"]);

		await browser.electron.execute((electron) => {
			// Call tracking is the contract here. Do not also serialize the mocked array
			// through CDP while the mock service synchronizes its state over the same bridge.
			electron.dialog.showOpenDialogSync({
				properties: ["openFile"],
			});
		});

		expect(mockShowOpenDialog).toHaveBeenCalledTimes(1);
		expect(mockShowOpenDialog).toHaveBeenCalledWith({
			properties: ["openFile"],
		});
	});
});
