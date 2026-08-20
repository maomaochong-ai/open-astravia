const packaged = process.env.VETTA_E2E_PACKAGED === "1";

describe("Vetta Desktop packaged updater", () => {
	(packaged ? it : it.skip)("checks the configured update feed through the renderer bridge", async () => {
		await browser.waitUntil(
			async () => {
				const ready = await browser.execute(() => document.readyState);
				return ready === "complete" || ready === "interactive";
			},
			{ timeout: 60_000, timeoutMsg: "Renderer was not ready before updater E2E" },
		);

		const result = await browser.execute(async () => {
			const currentVersion = await window.vetta.updater.getCurrentVersion();
			const state = await window.vetta.updater.check();
			return { currentVersion, state };
		});

		expect(result.currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
		expect(result.state.currentVersion).toBe(result.currentVersion);
		if (process.platform === "linux") {
			expect(result.state.phase).toBe("available");
			expect(result.state.latestVersion).not.toBe(result.currentVersion);

			const downloaded = await browser.execute(() => window.vetta.updater.download());
			expect(downloaded.phase).toBe("ready");
			expect(downloaded.progress).toBe(1);
		} else {
			expect(result.state.phase).toBe("idle");
			expect(result.state.latestVersion).toBe(result.currentVersion);
		}
		expect(result.state.error).toBeUndefined();
	});
});
